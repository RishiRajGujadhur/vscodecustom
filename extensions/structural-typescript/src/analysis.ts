/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as ts from 'typescript';
import { isReference, nodeAt, Project, walk } from './project';

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

function resolvedSymbol(project: Project, node: ts.Node): ts.Symbol | undefined {
	const symbol = project.checker.getSymbolAtLocation(node);
	return symbol && symbol.flags & ts.SymbolFlags.Alias ? project.checker.getAliasedSymbol(symbol) : symbol;
}

function describe(symbol: ts.Symbol, children: AnalysisNode[] = []): AnalysisNode | undefined {
	const declaration = symbol.valueDeclaration ?? symbol.declarations?.[0];
	if (!declaration) { return undefined; }
	return { label: symbol.name, fileName: declaration.getSourceFile().fileName, start: declaration.getStart(), end: declaration.end, children };
}

/** Type syntax dependencies, including inheritance, union and intersection branches. */
export function typeRelations(project: Project, symbol: ts.Symbol, reverse: boolean): ts.Symbol[] {
	const dependencies = (candidate: ts.Symbol): ts.Symbol[] => {
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
	};
	if (!reverse) { return dependencies(symbol); }
	const found = new Set<ts.Symbol>();
	for (const source of project.program.getSourceFiles()) {
		if (source.isDeclarationFile || project.program.isSourceFileFromExternalLibrary(source)) { continue; }
		walk(source, node => {
			if ((ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) && node.name) {
				const candidate = resolvedSymbol(project, node.name);
				if (candidate && candidate !== symbol && dependencies(candidate).includes(symbol)) { found.add(candidate); }
			}
		});
	}
	return [...found];
}

export function typeTree(project: Project, symbol: ts.Symbol, reverse: boolean, ancestors = new Set<ts.Symbol>(), depth = 0): AnalysisNode | undefined {
	const item = describe(symbol);
	if (!item) { return undefined; }
	if (ancestors.has(symbol) || depth >= 8) { return { ...item, label: `${item.label} (…)` }; }
	const seen = new Set(ancestors).add(symbol);
	return { ...item, children: typeRelations(project, symbol, reverse).flatMap(child => typeTree(project, child, reverse, seen, depth + 1) ?? []) };
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
				while (parent && !ts.isFunctionDeclaration(parent) && !ts.isMethodDeclaration(parent)) { parent = parent.parent; }
				if (parent && (ts.isFunctionDeclaration(parent) || ts.isMethodDeclaration(parent)) && parent.name) {
					for (const input of inputs(node.expression)) { link(input, resolvedSymbol(project, parent.name)); }
				}
			}
		});
	}
	const build = (current: ts.Symbol, seen: Set<ts.Symbol>, depth: number): AnalysisNode | undefined => {
		const item = describe(current);
		if (!item) { return undefined; }
		if (seen.has(current) || depth >= 8) { return { ...item, label: `${item.label} (…)` }; }
		const ancestors = new Set(seen).add(current);
		return { ...item, children: [...(edges.get(current) ?? [])].flatMap(next => build(next, ancestors, depth + 1) ?? []) };
	};
	return build(symbol, new Set(), 0);
}

export function unusedDiagnostics(project: Project): readonly ts.Diagnostic[] {
	const host = ts.createCompilerHost(project.program.getCompilerOptions());
	const read = host.readFile;
	host.readFile = file => project.program.getSourceFile(file)?.text ?? read(file);
	const program = ts.createProgram(project.program.getRootFileNames(), { ...project.program.getCompilerOptions(), noUnusedLocals: true, noUnusedParameters: true }, host);
	return program.getSemanticDiagnostics().filter(diagnostic => [6133, 6192, 6196, 6198, 6199].includes(diagnostic.code));
}
