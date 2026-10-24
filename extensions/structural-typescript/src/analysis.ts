/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as ts from 'typescript';
import { isReference, nodeAt, Project, resolvedSymbol, walk } from './project';

export interface AnalysisNode {
	readonly label: string;
	readonly fileName: string;
	readonly start: number;
	readonly end: number;
	readonly children: AnalysisNode[];
}

export function symbolAt(project: Project, fileName: string, offset: number): ts.Symbol | undefined {
	return resolvedSymbol(project, nodeAt(project.program.getSourceFile(fileName)!, offset));
}

function describe(symbol: ts.Symbol, children: AnalysisNode[] = []): AnalysisNode | undefined {
	const declaration = symbol.valueDeclaration ?? symbol.declarations?.[0];
	if (!declaration) { return undefined; }
	return { label: symbol.name, fileName: declaration.getSourceFile().fileName, start: declaration.getStart(), end: declaration.end, children };
}

/** Type syntax dependencies, including inheritance, union and intersection branches. */
function typeDependencies(project: Project, candidate: ts.Symbol): ts.Symbol[] {
	const found = new Set<ts.Symbol>();
	for (const declaration of candidate.declarations ?? []) {
		if (!ts.isInterfaceDeclaration(declaration) && !ts.isClassDeclaration(declaration) && !ts.isTypeAliasDeclaration(declaration)) { continue; }
		walk(declaration, node => {
			if (ts.isTypeReferenceNode(node) || ts.isExpressionWithTypeArguments(node)) {
				const target = resolvedSymbol(project, ts.isTypeReferenceNode(node) ? node.typeName : node.expression);
				if (target && target !== candidate) { found.add(target); }
			}
		});
	}
	return [...found];
}

function dependencyTree(symbol: ts.Symbol, dependencies: (symbol: ts.Symbol) => Iterable<ts.Symbol>): AnalysisNode | undefined {
	let budget = 500;
	const build = (current: ts.Symbol, seen: ReadonlySet<ts.Symbol>, depth: number): AnalysisNode | undefined => {
		const item = describe(current);
		if (!item) { return undefined; }
		budget--;
		if (seen.has(current) || depth >= 8 || budget <= 0) { return { ...item, label: `${item.label} (…)` }; }
		const ancestors = new Set(seen).add(current);
		for (const dependency of dependencies(current)) {
			const child = build(dependency, ancestors, depth + 1);
			if (child) { item.children.push(child); }
			if (budget <= 0) { break; }
		}
		return item;
	};
	return build(symbol, new Set(), 0);
}

export function typeTree(project: Project, symbol: ts.Symbol, reverse: boolean): AnalysisNode | undefined {
	const edges = new Map<ts.Symbol, Set<ts.Symbol>>();
	if (reverse) {
		for (const source of project.program.getSourceFiles()) {
			if (source.isDeclarationFile || project.program.isSourceFileFromExternalLibrary(source)) { continue; }
			walk(source, node => {
				if ((ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) && node.name) {
					const candidate = resolvedSymbol(project, node.name);
					if (!candidate) { return; }
					for (const dependency of typeDependencies(project, candidate)) {
						const dependents = edges.get(dependency) ?? new Set<ts.Symbol>();
						dependents.add(candidate);
						edges.set(dependency, dependents);
					}
				}
			});
		}
	}
	return dependencyTree(symbol, current => reverse ? edges.get(current) ?? [] : typeDependencies(project, current));
}

export function hierarchyRelations(project: Project, symbol: ts.Symbol, reverse: boolean): ts.Symbol[] {
	const bases = (candidate: ts.Symbol): ts.Symbol[] => (candidate.declarations ?? []).flatMap(declaration => {
		if (!ts.isInterfaceDeclaration(declaration) && !ts.isClassDeclaration(declaration)) { return []; }
		return (declaration.heritageClauses ?? []).flatMap(clause => clause.types.flatMap(type => resolvedSymbol(project, type.expression) ?? []));
	});
	if (!reverse) { return [...new Set(bases(symbol))]; }
	const found = new Set<ts.Symbol>();
	for (const source of project.program.getSourceFiles()) {
		if (source.isDeclarationFile || project.program.isSourceFileFromExternalLibrary(source)) { continue; }
		walk(source, node => {
			if ((ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node)) && node.name) {
				const candidate = resolvedSymbol(project, node.name);
				if (candidate && bases(candidate).includes(symbol)) { found.add(candidate); }
			}
		});
	}
	return [...found];
}

/** Explicit assignment/call edges. These describe possible static flows, not runtime traces. */
export function flowTree(project: Project, symbol: ts.Symbol, reverse: boolean): AnalysisNode | undefined {
	const edges = new Map<ts.Symbol, Set<ts.Symbol>>();
	const link = (from: ts.Symbol | undefined, to: ts.Symbol | undefined): void => {
		if (!from || !to || from === to) { return; }
		const key = reverse ? to : from;
		const value = reverse ? from : to;
		let targets = edges.get(key);
		if (!targets) { targets = new Set(); edges.set(key, targets); }
		targets.add(value);
	};
	const inputs = (expression: ts.Node): ts.Symbol[] => {
		const found = new Set<ts.Symbol>();
		walk(expression, node => {
			if (ts.isIdentifier(node) && isReference(node) || ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
				const value = resolvedSymbol(project, node);
				if (value) { found.add(value); }
			}
		});
		return [...found];
	};
	for (const source of project.program.getSourceFiles()) {
		if (source.isDeclarationFile || project.program.isSourceFileFromExternalLibrary(source)) { continue; }
		walk(source, node => {
			if ((ts.isVariableDeclaration(node) || ts.isPropertyDeclaration(node) || ts.isPropertyAssignment(node)) && node.initializer) {
				for (const input of inputs(node.initializer)) { link(input, resolvedSymbol(project, node.name)); }
			} else if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
				for (const input of inputs(node.right)) { link(input, resolvedSymbol(project, node.left)); }
			} else if (ts.isCallExpression(node)) {
				const signature = project.checker.getResolvedSignature(node);
				for (let index = 0; index < node.arguments.length; index++) {
					for (const input of inputs(node.arguments[index])) { link(input, signature?.parameters[index]); }
				}
			} else if (ts.isReturnStatement(node) && node.expression) {
				let parent: ts.Node | undefined = node.parent;
				while (parent && !ts.isFunctionLike(parent)) { parent = parent.parent; }
				if (parent && (ts.isFunctionDeclaration(parent) || ts.isMethodDeclaration(parent)) && parent.name) {
					for (const input of inputs(node.expression)) { link(input, resolvedSymbol(project, parent.name)); }
				}
			}
		});
	}
	return dependencyTree(symbol, current => edges.get(current) ?? []);
}

export function unusedDiagnostics(project: Project): readonly ts.Diagnostic[] {
	const host = ts.createCompilerHost(project.program.getCompilerOptions());
	host.getCurrentDirectory = () => project.directory;
	const read = host.readFile;
	host.readFile = file => project.program.getSourceFile(file)?.text ?? read(file);
	const program = ts.createProgram(project.program.getRootFileNames(), { ...project.program.getCompilerOptions(), noUnusedLocals: true, noUnusedParameters: true }, host);
	return [...program.getSemanticDiagnostics().filter(diagnostic => [6133, 6192, 6196, 6198, 6199].includes(diagnostic.code)), ...structuralDiagnostics(project)];
}

function structuralDiagnostics(project: Project): ts.Diagnostic[] {
	const reads = new Set<ts.Symbol>();
	const candidates: ts.PropertySignature[] = [];
	const result: ts.Diagnostic[] = [];
	const markProperties = (node: ts.Node): void => { for (const property of project.checker.getTypeAtLocation(node).getProperties()) { reads.add(property); } };
	const report = (node: ts.Node, code: number, messageText: string): void => { result.push({ file: node.getSourceFile(), start: node.getStart(), length: node.getWidth(), category: ts.DiagnosticCategory.Suggestion, code, messageText }); };
	for (const source of project.program.getSourceFiles()) {
		if (source.isDeclarationFile || project.program.isSourceFileFromExternalLibrary(source)) { continue; }
		const module = project.checker.getSymbolAtLocation(source);
		if (module) {
			for (let exported of project.checker.getExportsOfModule(module)) {
				if (exported.flags & ts.SymbolFlags.Alias) { exported = project.checker.getAliasedSymbol(exported); }
				for (const property of project.checker.getDeclaredTypeOfSymbol(exported).getProperties()) { reads.add(property); }
			}
		}
		walk(source, node => {
			if (ts.isInterfaceDeclaration(node) && ts.isExternalModule(source) && !(ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Export)) {
				candidates.push(...node.members.filter(ts.isPropertySignature));
			}
			if (ts.isPropertyAccessExpression(node)) {
				const parent = node.parent;
				if (!(ts.isBinaryExpression(parent) && parent.left === node && parent.operatorToken.kind === ts.SyntaxKind.EqualsToken)) {
					const symbol = resolvedSymbol(project, node.name);
					if (symbol) { reads.add(symbol); }
				}
			} else if (ts.isElementAccessExpression(node)) {
				if (ts.isStringLiteralLike(node.argumentExpression)) {
					const property = project.checker.getTypeAtLocation(node.expression).getProperty(node.argumentExpression.text);
					if (property) { reads.add(property); }
				} else { markProperties(node.expression); }
			} else if (ts.isBindingElement(node) && ts.isObjectBindingPattern(node.parent)) {
				if (node.dotDotDotToken) { markProperties(node.parent); }
				else {
					const name = node.propertyName ?? node.name;
					if (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) {
						const property = project.checker.getTypeAtLocation(node.parent).getProperty(name.text);
						if (property) { reads.add(property); }
					}
				}
			} else if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
				for (const argument of node.arguments ?? []) { markProperties(argument); }
			} else if (ts.isSpreadAssignment(node) || ts.isSpreadElement(node) || ts.isReturnStatement(node) && node.expression) { markProperties(node.expression!); }
			else if (ts.isTypeOperatorNode(node) && node.operator === ts.SyntaxKind.KeyOfKeyword) { markProperties(node.type); }
			if (ts.isBinaryExpression(node) && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken].includes(node.operatorToken.kind)) {
				const operand = ts.isTypeOfExpression(node.left) && ts.isStringLiteral(node.right) ? [node.left.expression, node.right.text] as const
					: ts.isTypeOfExpression(node.right) && ts.isStringLiteral(node.left) ? [node.right.expression, node.left.text] as const : undefined;
				if (!operand) { return; }
				const type = project.checker.getTypeAtLocation(operand[0]);
				const parts = type.isUnion() ? type.types : [type];
				const kind = (part: ts.Type): string | undefined => part.flags & ts.TypeFlags.StringLike ? 'string' : part.flags & ts.TypeFlags.NumberLike ? 'number' : part.flags & ts.TypeFlags.BooleanLike ? 'boolean' : part.flags & ts.TypeFlags.BigIntLike ? 'bigint' : part.flags & ts.TypeFlags.ESSymbolLike ? 'symbol' : part.flags & ts.TypeFlags.Undefined ? 'undefined' : undefined;
				const kinds = parts.map(kind);
				if (kinds.every(value => value !== undefined) && (kinds.every(value => value === operand[1]) || kinds.every(value => value !== operand[1]))) {
					report(node, 98002, 'This typeof guard is constant according to the static type. Runtime values outside the declared type may differ.');
				}
			}
		});
	}
	for (const property of candidates) {
		const symbol = project.checker.getSymbolAtLocation(property.name);
		if (symbol && !reads.has(symbol)) { report(property.name, 98001, 'No statically resolved reads of this internal interface field were found. Dynamic accesses may still use it.'); }
	}
	return result;
}
