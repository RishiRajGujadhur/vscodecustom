/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as ts from 'typescript';
import { Project, nodeAt, resolvedSymbol, walk } from './project';
import { Change } from './refactor';
import { validateChanges } from './globalRefactor';

export interface SignatureParameter {
	readonly originalIndex?: number;
	readonly name: string;
	readonly type?: string;
	readonly optional?: boolean;
	readonly defaultValue?: string | null;
	readonly migrationValue?: string;
}
export type SignatureErrorCode = 'target' | 'parameters' | 'migration' | 'callers' | 'effects' | 'syntax' | 'bodyReference' | 'dynamic';
export class SignatureError extends Error { constructor(readonly code: SignatureErrorCode) { super(code); } }
type Declaration = ts.FunctionDeclaration | ts.MethodDeclaration | ts.MethodSignature | ts.ConstructorDeclaration;
function isDeclaration(node: ts.Node): node is Declaration { return ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isMethodSignature(node) || ts.isConstructorDeclaration(node); }
function declarationAt(source: ts.SourceFile, offset: number): Declaration | undefined {
	let node = nodeAt(source, offset);
	while (node.parent && !isDeclaration(node) && !ts.isClassDeclaration(node)) { node = node.parent; }
	if (isDeclaration(node)) { return node; }
	if (ts.isClassDeclaration(node)) { return node.members.find(ts.isConstructorDeclaration); }
	return undefined;
}
function nameOf(declaration: Declaration): ts.DeclarationName | undefined { return ts.isConstructorDeclaration(declaration) && ts.isClassDeclaration(declaration.parent) ? declaration.parent.name : declaration.name; }
function hasBody(declaration: Declaration): boolean { return !ts.isMethodSignature(declaration) && !!declaration.body; }
function related(project: Project, initial: Declaration): Declaration[] {
	const result = new Set<Declaration>([initial]);
	for (const declaration of result) {
		const name = nameOf(declaration);
		if (!name) { throw new SignatureError('target'); }
		const symbol = resolvedSymbol(project, name);
		if (ts.isConstructorDeclaration(declaration)) {
			if (!ts.isClassDeclaration(declaration.parent)) { throw new SignatureError('target'); }
			for (const member of declaration.parent.members) { if (ts.isConstructorDeclaration(member)) { result.add(member); } }
		} else {
			for (const candidate of symbol?.declarations ?? []) { if (isDeclaration(candidate)) { result.add(candidate); } }
			if (ts.isMethodDeclaration(declaration) || ts.isMethodSignature(declaration)) {
				const locations = [...project.service.getImplementationAtPosition(declaration.getSourceFile().fileName, name.getStart()) ?? [], ...project.service.findReferences(declaration.getSourceFile().fileName, name.getStart())?.map(group => group.definition) ?? []];
				for (const location of locations) {
					const source = project.program.getSourceFile(location.fileName);
					const candidate = source ? declarationAt(source, location.textSpan.start) : undefined;
					if (candidate && (ts.isMethodDeclaration(candidate) || ts.isMethodSignature(candidate))) { result.add(candidate); }
				}
			}
		}
	}
	return [...result];
}
function target(project: Project, fileName: string, offset: number): Declaration[] {
	const source = project.program.getSourceFile(fileName)!;
	const initial = declarationAt(source, offset);
	if (!initial) { throw new SignatureError('target'); }
	const declarations = related(project, initial);
	const first = declarations.find(hasBody) ?? declarations[0];
	if (declarations.some(declaration => declaration.getSourceFile().isDeclarationFile || declaration.parameters.length !== first.parameters.length || declaration.parameters.some((parameter, index) => !ts.isIdentifier(parameter.name) || parameter.name.getText() !== first.parameters[index].name.getText() || parameter.dotDotDotToken || parameter.modifiers?.length || parameter.name.getText() === 'this') || /\/\*|\/\//.test(declaration.getSourceFile().text.slice(declaration.parameters.pos, declaration.parameters.end)))) { throw new SignatureError('parameters'); }
	for (const declaration of declarations) { if (hasBody(declaration)) { walk(declaration, node => { if (ts.isIdentifier(node) && node.text === 'arguments' || ts.isYieldExpression(node)) { throw new SignatureError('dynamic'); } }); } }
	return [first, ...declarations.filter(declaration => declaration !== first)];
}
export function currentSignature(project: Project, fileName: string, offset: number): { name: string; parameters: readonly SignatureParameter[] } {
	const declaration = target(project, fileName, offset)[0];
	return { name: nameOf(declaration)!.getText(), parameters: declaration.parameters.map((parameter, originalIndex) => ({ originalIndex, name: parameter.name.getText(), optional: !!parameter.questionToken, defaultValue: parameter.initializer?.getText() })) };
}
export function validExpression(text: string): boolean {
	const source = ts.createSourceFile('expression.ts', `const value = (${text});`, ts.ScriptTarget.Latest, true);
	const statement = source.statements[0];
	return source.statements.length === 1 && ts.isVariableStatement(statement) && statement.declarationList.declarations.length === 1 && !!statement.declarationList.declarations[0].initializer && !ts.transpileModule(source.text, { reportDiagnostics: true }).diagnostics?.some(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error);
}
function stable(expression: ts.Expression): boolean {
	return ts.isIdentifier(expression) || ts.isStringLiteralLike(expression) || ts.isNumericLiteral(expression) || ts.isArrowFunction(expression) || [ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword, ts.SyntaxKind.NullKeyword].includes(expression.kind) || ts.isParenthesizedExpression(expression) && stable(expression.expression);
}
function typeOnly(node: ts.Node): boolean {
	let parent: ts.Node | undefined = node.parent;
	while (parent && !ts.isStatement(parent)) { if (ts.isTypeNode(parent)) { return true; } parent = parent.parent; }
	return false;
}

/** Rewrites a complete family of supported declarations and resolved, non-escaping direct calls. */
export function changeSignature(project: Project, fileName: string, offset: number, parameters: readonly SignatureParameter[]): { changes: readonly Change[]; signature: string; callers: number } {
	const declarations = target(project, fileName, offset), base = declarations[0];
	if (!/\.(?:[cm]?ts|tsx)$/i.test(fileName) && !project.program.getCompilerOptions().checkJs) { throw new SignatureError('parameters'); }
	const indices = parameters.flatMap(parameter => parameter.originalIndex === undefined ? [] : [parameter.originalIndex]);
	if (parameters.length > 24 || new Set(parameters.map(parameter => parameter.name)).size !== parameters.length || new Set(indices).size !== indices.length || indices.some(index => !Number.isInteger(index) || index < 0 || index >= base.parameters.length) || parameters.some(parameter => !/^[$A-Z_a-z][$\w]*$/.test(parameter.name) || parameter.defaultValue !== undefined && parameter.defaultValue !== null && !validExpression(parameter.defaultValue) || parameter.migrationValue !== undefined && !validExpression(parameter.migrationValue))) { throw new SignatureError('syntax'); }
	if (base.parameters.some((parameter, index) => !indices.includes(index) && parameter.initializer && !(ts.isStringLiteralLike(parameter.initializer) || ts.isNumericLiteral(parameter.initializer) || ts.isArrowFunction(parameter.initializer) || ts.isFunctionExpression(parameter.initializer) || [ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword, ts.SyntaxKind.NullKeyword].includes(parameter.initializer.kind)))) { throw new SignatureError('effects'); }
	const changes: Change[] = [], renames: Change[] = [];
	for (const declaration of declarations) {
		for (const parameter of parameters) {
			const old = parameter.originalIndex === undefined ? undefined : declaration.parameters[parameter.originalIndex];
			if (old?.name.getText() === parameter.name) { continue; }
			const movedAway = declaration.parameters.filter((candidate, index) => parameters.some(next => next.originalIndex === index && next.name !== candidate.name.getText())).map(candidate => resolvedSymbol(project, candidate.name));
			if (project.checker.getSymbolsInScope(declaration, ts.SymbolFlags.Value).some(symbol => symbol.name === parameter.name && !movedAway.includes(symbol))) { throw new SignatureError('parameters'); }
			walk(declaration, node => {
				if (ts.isIdentifier(node) && node.text === parameter.name && !movedAway.includes(resolvedSymbol(project, node))) { throw new SignatureError('parameters'); }
			});
		}
		for (const [index, old] of declaration.parameters.entries()) {
			const next = parameters.find(parameter => parameter.originalIndex === index);
			const references = project.service.findReferences(declaration.getSourceFile().fileName, old.name.getStart())?.flatMap(group => group.references) ?? [];
			if (!next && references.some(reference => !reference.isDefinition && reference.textSpan.start !== old.name.getStart() && !declaration.parameters.some(parameter => !indices.includes(declaration.parameters.indexOf(parameter)) && parameter.getStart() <= reference.textSpan.start && reference.textSpan.start < parameter.end && reference.fileName === declaration.getSourceFile().fileName))) { throw new SignatureError('bodyReference'); }
			if (next && next.name !== old.name.getText()) {
				for (const location of project.service.findRenameLocations(declaration.getSourceFile().fileName, old.name.getStart(), false, false, true) ?? []) {
					renames.push({ fileName: location.fileName, start: location.textSpan.start, length: location.textSpan.length, text: `${location.prefixText ?? ''}${next.name}${location.suffixText ?? ''}` });
				}
			}
		}
	}
	const renamedText = (node: ts.Node): string => {
		let text = node.getText();
		const start = node.getStart();
		for (const rename of renames.filter(rename => rename.fileName === node.getSourceFile().fileName && start <= rename.start && rename.start + rename.length <= node.end).sort((a, b) => b.start - a.start)) { text = text.slice(0, rename.start - start) + rename.text + text.slice(rename.start - start + rename.length); }
		return text;
	};
	for (const declaration of declarations) {
		const typed = /\.(?:[cm]?ts|tsx)$/i.test(declaration.getSourceFile().fileName);
		const rendered = parameters.map(parameter => {
			const original = parameter.originalIndex === undefined ? undefined : declaration.parameters[parameter.originalIndex];
			const type = parameter.type ?? (original?.type ? renamedText(original.type) : undefined);
			const initializer = parameter.defaultValue === undefined ? original?.initializer ? renamedText(original.initializer) : undefined : parameter.defaultValue ?? undefined;
			const optional = parameter.optional ?? !!original?.questionToken;
			if (!original && !optional && !initializer && parameter.migrationValue === undefined) { throw new SignatureError('migration'); }
			return `${parameter.name}${optional || initializer && !hasBody(declaration) ? '?' : ''}${typed && type ? ': ' + type : ''}${initializer && hasBody(declaration) ? ' = ' + initializer : ''}`;
		}).join(', ');
		const check = ts.createSourceFile('signature.ts', `function candidate(${rendered}) {}`, ts.ScriptTarget.Latest, true);
		if (check.statements.length !== 1 || !ts.isFunctionDeclaration(check.statements[0]) || check.statements[0].parameters.length !== parameters.length || !ts.transpileModule(check.text, { reportDiagnostics: true }).diagnostics?.every(diagnostic => diagnostic.category !== ts.DiagnosticCategory.Error)) { throw new SignatureError('syntax'); }
		changes.push({ fileName: declaration.getSourceFile().fileName, start: declaration.parameters.pos, length: declaration.parameters.end - declaration.parameters.pos, text: rendered });
	}
	const symbols = new Set(declarations.map(declaration => resolvedSymbol(project, nameOf(declaration)!)).filter(symbol => !!symbol));
	const calls = new Set<ts.CallExpression | ts.NewExpression>();
	const constructor = declarations.some(ts.isConstructorDeclaration);
	for (const source of project.program.getSourceFiles()) {
		if (source.isDeclarationFile || project.program.isSourceFileFromExternalLibrary(source)) { continue; }
		walk(source, node => {
			if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
				const signature = project.checker.getResolvedSignature(node);
				const symbol = resolvedSymbol(project, ts.isPropertyAccessExpression(node.expression) ? node.expression.name : node.expression);
				if (signature?.declaration && declarations.includes(signature.declaration as Declaration) || symbol && symbols.has(symbol)) {
					if (constructor !== ts.isNewExpression(node) || ts.isCallExpression(node) && ts.isCallChain(node)) { throw new SignatureError('callers'); }
					calls.add(node);
				}
				if (['eval', 'Reflect.apply', 'Reflect.construct'].includes(node.expression.getText())) { throw new SignatureError('dynamic'); }
			}
			if (ts.isElementAccessExpression(node) && !ts.isStringLiteralLike(node.argumentExpression) && !constructor) {
				const receiver = project.checker.getTypeAtLocation(node.expression);
				if (receiver.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown) || [...symbols].some(symbol => receiver.getProperty(symbol.name))) { throw new SignatureError('dynamic'); }
			}
			if (!ts.isIdentifier(node) && !ts.isPrivateIdentifier(node) && !ts.isStringLiteralLike(node)) { return; }
			const referenceSymbol = ts.isStringLiteralLike(node) && ts.isElementAccessExpression(node.parent) ? project.checker.getTypeAtLocation(node.parent.expression).getProperty(node.text) : resolvedSymbol(project, node);
			const matches = referenceSymbol && (symbols.has(referenceSymbol) || referenceSymbol.declarations?.some(declaration => declarations.includes(declaration as Declaration)));
			if (!matches || declarations.some(declaration => nameOf(declaration) === node) || typeOnly(node)) { return; }
			if (ts.isImportSpecifier(node.parent) || ts.isExportSpecifier(node.parent) || ts.isImportClause(node.parent)) { return; }
			const expression = ts.isPropertyAccessExpression(node.parent) && node.parent.name === node || ts.isElementAccessExpression(node.parent) && node.parent.argumentExpression === node ? node.parent : node;
			if (!(ts.isCallExpression(expression.parent) || ts.isNewExpression(expression.parent)) || expression.parent.expression !== expression) { throw new SignatureError('callers'); }
		});
	}
	const reordered = indices.some((index, position) => position > 0 && index < indices[position - 1]);
	if (reordered && base.parameters.some(parameter => !!parameter.initializer)) { throw new SignatureError('effects'); }
	for (const call of calls) {
		const args = call.arguments;
		if (!args || args.length > base.parameters.length || args.some(ts.isSpreadElement)) { throw new SignatureError('callers'); }
		if (reordered && args.some(argument => !stable(argument)) || args.some((argument, index) => !indices.includes(index) && !stable(argument))) { throw new SignatureError('effects'); }
		const rendered: (string | undefined)[] = parameters.map(parameter => parameter.originalIndex === undefined ? parameter.migrationValue : args[parameter.originalIndex] ? renamedText(args[parameter.originalIndex]) : undefined);
		while (rendered.length && rendered[rendered.length - 1] === undefined) { rendered.pop(); }
		changes.push({ fileName: call.getSourceFile().fileName, start: args.pos, length: args.end - args.pos, text: rendered.map(value => value ?? 'undefined').join(', ') });
	}
	const occupied = [...changes];
	for (const rename of renames) { if (!occupied.some(change => change.fileName === rename.fileName && change.start <= rename.start && rename.start + rename.length <= change.start + change.length)) { changes.push(rename); } }
	const unique = [...new Map(changes.map(change => [`${change.fileName}:${change.start}:${change.length}`, change])).values()].map(change => ({ ...change, documentText: project.program.getSourceFile(change.fileName)!.text }));
	validateChanges(project, unique);
	return { changes: unique, signature: `${nameOf(base)!.getText()}(${unique[0].text})`, callers: calls.size };
}
