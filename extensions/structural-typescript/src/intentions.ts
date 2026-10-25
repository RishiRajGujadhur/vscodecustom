/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as ts from 'typescript';
import { Project, isLexicalValue, nodeAt, resolvedSymbol, walk } from './project';
import { Change } from './refactor';
import { validateChanges } from './globalRefactor';

export interface IntentionContext { readonly project: Project; readonly source: ts.SourceFile; readonly node: ts.Node }
export interface IntentionRule {
	readonly id: string;
	isApplicable(context: IntentionContext): boolean;
	getEdits(context: IntentionContext): readonly Change[] | undefined;
	validate(context: IntentionContext, edits: readonly Change[]): void;
}
function rule(id: string, plan: (context: IntentionContext) => readonly Change[] | undefined): IntentionRule {
	return { id, isApplicable: context => plan(context) !== undefined, getEdits: plan, validate: (context, edits) => validateChanges(context.project, edits) };
}
function edit(source: ts.SourceFile, node: ts.Node, text: string): Change { return { fileName: source.fileName, start: node.getStart(source), length: node.getWidth(source), text, documentText: source.text }; }
function returned(statement: ts.Statement | undefined): ts.Expression | undefined {
	if (statement && ts.isBlock(statement) && statement.statements.length === 1) { statement = statement.statements[0]; }
	return statement && ts.isReturnStatement(statement) ? statement.expression : undefined;
}
function primitive(project: Project, expression: ts.Expression): boolean {
	return !!(project.checker.getTypeAtLocation(expression).flags & (ts.TypeFlags.StringLike | ts.TypeFlags.NumberLike | ts.TypeFlags.BooleanLike | ts.TypeFlags.Null | ts.TypeFlags.Undefined));
}
/** Only expressions without getters, coercion of objects, calls, or writes. */
function pure(project: Project, expression: ts.Expression): boolean {
	if (ts.isIdentifier(expression)) { return isLexicalValue(project, expression) && primitive(project, expression); }
	if (ts.isStringLiteral(expression) || ts.isNumericLiteral(expression) || [ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword, ts.SyntaxKind.NullKeyword].includes(expression.kind)) { return true; }
	if (ts.isParenthesizedExpression(expression)) { return pure(project, expression.expression); }
	return ts.isBinaryExpression(expression) && expression.operatorToken.kind < ts.SyntaxKind.FirstAssignment && primitive(project, expression.left) && primitive(project, expression.right) && pure(project, expression.left) && pure(project, expression.right);
}
function hasLexicalContext(node: ts.Node): boolean {
	let unsafe = false;
	walk(node, child => { if ([ts.SyntaxKind.ThisKeyword, ts.SyntaxKind.SuperKeyword].includes(child.kind) || ts.isMetaProperty(child) || ts.isIdentifier(child) && ['arguments', 'eval'].includes(child.text)) { unsafe = true; } });
	return unsafe;
}
function localDirectCalls(project: Project, name: ts.Identifier): boolean {
	const symbol = resolvedSymbol(project, name);
	let safe = true;
	walk(name.getSourceFile(), child => {
		if (ts.isIdentifier(child) && child.text === 'eval') { safe = false; }
		if (ts.isIdentifier(child) && child !== name && resolvedSymbol(project, child) === symbol && (!ts.isCallExpression(child.parent) || child.parent.expression !== child)) { safe = false; }
	});
	return safe;
}

export const intentionRules: readonly IntentionRule[] = [
	rule('ifToTernary', ({ source, node }) => {
		if (!ts.isIfStatement(node)) { return; }
		const yes = returned(node.thenStatement), no = returned(node.elseStatement);
		return yes && no ? [edit(source, node, `return (${node.expression.getText()}) ? (${yes.getText()}) : (${no.getText()});`)] : undefined;
	}),
	rule('ternaryToIf', ({ source, node }) => {
		if (!ts.isReturnStatement(node) || !node.expression || !ts.isConditionalExpression(node.expression)) { return; }
		const value = node.expression;
		return [edit(source, node, `if (${value.condition.getText()}) { return ${value.whenTrue.getText()}; } else { return ${value.whenFalse.getText()}; }`)];
	}),
	rule('loopToMap', ({ project, source, node }) => {
		if (!ts.isForOfStatement(node) || node.awaitModifier || !ts.isArrayLiteralExpression(node.expression) || !node.expression.elements.every(element => ts.isNumericLiteral(element)) || !ts.isVariableDeclarationList(node.initializer) || !(node.initializer.flags & ts.NodeFlags.Const) || node.initializer.declarations.length !== 1 || !ts.isBlock(node.statement) || node.statement.statements.length !== 1 || !ts.isBlock(node.parent)) { return; }
		const binding = node.initializer.declarations[0].name;
		const statement = node.statement.statements[0];
		if (!ts.isIdentifier(binding) || !ts.isExpressionStatement(statement) || !ts.isCallExpression(statement.expression)) { return; }
		const call = statement.expression;
		if (!ts.isPropertyAccessExpression(call.expression) || call.expression.name.text !== 'push' || !ts.isIdentifier(call.expression.expression) || call.arguments.length !== 1 || !pure(project, call.arguments[0])) { return; }
		const previous = node.parent.statements[node.parent.statements.indexOf(node) - 1];
		if (!previous || !ts.isVariableStatement(previous) || !(previous.declarationList.flags & ts.NodeFlags.Const) || previous.declarationList.declarations.length !== 1) { return; }
		const declaration = previous.declarationList.declarations[0];
		if (!ts.isIdentifier(declaration.name) || declaration.name.text !== call.expression.expression.text || !declaration.initializer || !ts.isArrayLiteralExpression(declaration.initializer) || declaration.initializer.elements.length) { return; }
		let capturesOutput = false;
		walk(call.arguments[0], child => { if (ts.isIdentifier(child) && resolvedSymbol(project, child) === resolvedSymbol(project, declaration.name)) { capturesOutput = true; } });
		if (capturesOutput) { return; }
		return [edit(source, declaration.initializer, `${node.expression.getText()}.map(${binding.text} => ${call.arguments[0].getText()})`), edit(source, node, '')];
	}),
	rule('promiseToAwait', ({ project, source, node }) => {
		// Keep the async boundary and require a single, expression-bodied fulfillment handler.
		if (!ts.isReturnStatement(node) || !node.expression || !ts.isCallExpression(node.expression)) { return; }
		const call = node.expression;
		if (!ts.isPropertyAccessExpression(call.expression) || call.expression.name.text !== 'then' || call.arguments.length !== 1 || !ts.isArrowFunction(call.arguments[0])) { return; }
		const callback = call.arguments[0];
		if (callback.parameters.length !== 1 || !ts.isIdentifier(callback.parameters[0].name) || callback.parameters[0].initializer || callback.parameters[0].dotDotDotToken || ts.isBlock(callback.body) || !pure(project, callback.body) || hasLexicalContext(callback.body)) { return; }
		let owner: ts.Node | undefined = node.parent;
		while (owner && !ts.isFunctionLike(owner)) { owner = owner.parent; }
		if (!owner || !ts.canHaveModifiers(owner) || !ts.getModifiers(owner)?.some(modifier => modifier.kind === ts.SyntaxKind.AsyncKeyword)) { return; }
		const receiver = call.expression.expression;
		if (!ts.isCallExpression(receiver) || !ts.isPropertyAccessExpression(receiver.expression) || receiver.expression.expression.getText() !== 'Promise' || receiver.expression.name.text !== 'resolve' || receiver.arguments.length !== 1 || !pure(project, receiver.arguments[0])) { return; }
		if (!resolvedSymbol(project, receiver.expression.expression)?.declarations?.every(declaration => project.program.isSourceFileDefaultLibrary(declaration.getSourceFile()))) { return; }
		if (project.checker.getSymbolsInScope(node, ts.SymbolFlags.Value).some(symbol => symbol.name === 'awaitedValue')) { return; }
		const value = callback.parameters[0].name.text;
		// An IIFE retains the callback parameter scope and avoids capturing surrounding names.
		return [edit(source, node, `return (async () => { const awaitedValue = await ${receiver.getText()};\nreturn ((${value}${callback.parameters[0].type ? ': ' + callback.parameters[0].type.getText() : ''}) => ${callback.body.getText()})(awaitedValue); })();`)];
	}),
	rule('functionToArrow', ({ project, source, node }) => {
		if (!ts.isFunctionExpression(node) || node.name || node.asteriskToken || hasLexicalContext(node) || !ts.isVariableDeclaration(node.parent) || !ts.isIdentifier(node.parent.name) || !ts.isVariableDeclarationList(node.parent.parent) || !(node.parent.parent.flags & ts.NodeFlags.Const) || !ts.isVariableStatement(node.parent.parent.parent) || !ts.isBlock(node.parent.parent.parent.parent) || !localDirectCalls(project, node.parent.name)) { return; }
		return [edit(source, node, `${node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.AsyncKeyword) ? 'async ' : ''}${node.typeParameters ? '<' + node.typeParameters.map(type => type.getText()).join(', ') + '>' : ''}(${node.parameters.map(parameter => parameter.getText()).join(', ')})${node.type ? ': ' + node.type.getText() : ''} => ${node.body.getText()}`)];
	}),
	rule('extractRepeated', ({ project, source, node }) => {
		if (!ts.isReturnStatement(node) || !node.expression || !ts.isBlock(node.parent) || !pure(project, node.expression)) { return; }
		const candidates: ts.BinaryExpression[] = [];
		walk(node.expression, child => { if (ts.isBinaryExpression(child) && pure(project, child)) { candidates.push(child); } });
		const repeated = candidates.find(candidate => candidates.filter(other => other.getText() === candidate.getText()).length > 1);
		if (!repeated || project.checker.getSymbolsInScope(node, ts.SymbolFlags.Value).some(symbol => symbol.name === 'extractedValue')) { return; }
		const matches = candidates.filter(candidate => candidate.getText() === repeated.getText());
		return [{ fileName: source.fileName, start: node.getStart(), length: 0, text: `const extractedValue = ${repeated.getText()};\n`, documentText: source.text }, ...matches.map(match => edit(source, match, 'extractedValue'))];
	}),
	rule('simplifyBoolean', ({ project, source, node }) => {
		if (!ts.isBinaryExpression(node) || node.operatorToken.kind !== ts.SyntaxKind.EqualsEqualsEqualsToken || node.right.kind !== ts.SyntaxKind.TrueKeyword || !(project.checker.getTypeAtLocation(node.left).flags & ts.TypeFlags.BooleanLike)) { return; }
		return [edit(source, node, `(${node.left.getText()})`)];
	}),
	rule('nullGuard', ({ project, source, node }) => {
		if (!ts.isExpressionStatement(node) || !ts.isCallExpression(node.expression) || !ts.isPropertyAccessExpression(node.expression.expression)) { return; }
		const receiver = node.expression.expression.expression;
		if (!ts.isIdentifier(receiver)) { return; }
		const type = project.checker.getTypeAtLocation(receiver);
		if (!type.isUnion() || !type.types.some(part => part.flags & (ts.TypeFlags.Null | ts.TypeFlags.Undefined))) { return; }
		return [edit(source, node, `if (${receiver.text} != null) { ${node.getText()} }`)];
	}),
	rule('guardClause', ({ source, node }) => {
		if (!ts.isIfStatement(node) || !ts.isBlock(node.parent) || !node.elseStatement || !returned(node.thenStatement) || !returned(node.elseStatement)) { return; }
		return [edit(source, node, `if (${node.expression.getText()}) { return ${returned(node.thenStatement)!.getText()}; }\nreturn ${returned(node.elseStatement)!.getText()};`)];
	}),
	rule('stringTemplate', ({ project, source, node }) => {
		if (!ts.isBinaryExpression(node) || node.operatorToken.kind !== ts.SyntaxKind.PlusToken || !(project.checker.getTypeAtLocation(node.left).flags & ts.TypeFlags.StringLike) || !(project.checker.getTypeAtLocation(node.right).flags & ts.TypeFlags.StringLike)) { return; }
		return [edit(source, node, '`' + '${' + node.left.getText() + '}${' + node.right.getText() + '}`')];
	}),
	rule('preferConst', ({ project, source, node }) => {
		if (!ts.isVariableDeclarationList(node) || !(node.flags & ts.NodeFlags.Let) || !ts.isVariableStatement(node.parent) || !ts.isBlock(node.parent.parent) || node.declarations.some(declaration => !ts.isIdentifier(declaration.name) || !declaration.initializer)) { return; }
		let unsafe = false;
		walk(node.parent.parent, child => { if (ts.isIdentifier(child) && child.text === 'eval') { unsafe = true; } });
		for (const declaration of node.declarations) {
			const references = project.service.findReferences(source.fileName, declaration.name.getStart());
			if (!references || references.some(group => group.references.some(reference => reference.isWriteAccess && !reference.isDefinition && reference.textSpan.start !== declaration.name.getStart()))) { unsafe = true; }
		}
		return unsafe ? undefined : [{ fileName: source.fileName, start: node.getStart(), length: 3, text: 'const', documentText: source.text }];
	}),
	rule('objectMethod', ({ project, source, node }) => {
		if (!ts.isPropertyAssignment(node) || !ts.isIdentifier(node.name) || !ts.isFunctionExpression(node.initializer) || node.initializer.name || node.initializer.asteriskToken || hasLexicalContext(node.initializer) || !ts.isObjectLiteralExpression(node.parent) || !ts.isVariableDeclaration(node.parent.parent) || !ts.isIdentifier(node.parent.parent.name)) { return; }
		const object = node.parent.parent;
		if (!ts.isVariableDeclarationList(object.parent) || !(object.parent.flags & ts.NodeFlags.Const) || !ts.isVariableStatement(object.parent.parent) || !ts.isBlock(object.parent.parent.parent)) { return; }
		let safe = true;
		walk(object.parent.parent.parent, child => {
			if (ts.isIdentifier(child) && child.text === 'eval') { safe = false; }
			if (ts.isIdentifier(child) && child !== object.name && resolvedSymbol(project, child) === resolvedSymbol(project, object.name)) {
				if (!ts.isPropertyAccessExpression(child.parent) || child.parent.expression !== child || child.parent.name.text !== node.name.getText() || !ts.isCallExpression(child.parent.parent) || child.parent.parent.expression !== child.parent) { safe = false; }
			}
		});
		const fn = node.initializer;
		return safe ? [edit(source, node, `${fn.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.AsyncKeyword) ? 'async ' : ''}${node.name.text}${fn.typeParameters ? '<' + fn.typeParameters.map(type => type.getText()).join(', ') + '>' : ''}(${fn.parameters.map(parameter => parameter.getText()).join(', ')})${fn.type ? ': ' + fn.type.getText() : ''} ${fn.body.getText()}`)] : undefined;
	}),
	rule('optionalAccess', ({ project, source, node }) => {
		if (!ts.isIfStatement(node) || node.elseStatement || !ts.isBinaryExpression(node.expression) || node.expression.operatorToken.kind !== ts.SyntaxKind.ExclamationEqualsToken || !ts.isIdentifier(node.expression.left) || node.expression.right.kind !== ts.SyntaxKind.NullKeyword || !ts.isBlock(node.parent)) { return; }
		const yes = returned(node.thenStatement);
		const next = node.parent.statements[node.parent.statements.indexOf(node) + 1];
		if (!yes || !ts.isPropertyAccessExpression(yes) || !ts.isIdentifier(yes.expression) || resolvedSymbol(project, yes.expression) !== resolvedSymbol(project, node.expression.left) || !next || !ts.isReturnStatement(next) || !next.expression || !ts.isIdentifier(next.expression) || next.expression.text !== 'undefined' || !(project.checker.getTypeAtLocation(next.expression).flags & ts.TypeFlags.Undefined)) { return; }
		return [edit(source, node, `return ${yes.expression.text}?.${yes.name.text};`), edit(source, next, '')];
	})
];

export function intentionsAt(project: Project, fileName: string, offset: number): { rule: IntentionRule; context: IntentionContext }[] {
	const source = project.program.getSourceFile(fileName)!;
	const result: { rule: IntentionRule; context: IntentionContext }[] = [];
	const seen = new Set<string>();
	let node: ts.Node | undefined = nodeAt(source, offset);
	while (node && !ts.isSourceFile(node)) {
		const context = { project, source, node };
		// Rules that rebuild a node must never silently lose comments or directives.
		if (!/\/\*|\/\//.test(node.getText(source))) {
			for (const rule of intentionRules) { if (!seen.has(rule.id) && rule.isApplicable(context)) { result.push({ rule, context }); seen.add(rule.id); } }
		}
		node = node.parent;
	}
	return result;
}
