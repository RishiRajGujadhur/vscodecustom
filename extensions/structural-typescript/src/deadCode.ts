/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as ts from 'typescript';
import * as path from 'node:path';
import { Project, resolvedSymbol, walk } from './project';

export interface DeadCodeFinding { readonly fileName: string; readonly start: number; readonly length: number; readonly name: string; readonly kind: 'export' | 'component' | 'function' | 'file' }

/** Static symbol reachability from executable code and public entry-point exports. */
export function findDeadCode(project: Project, entries: readonly string[]): DeadCodeFinding[] {
	const files = project.program.getSourceFiles().filter(file => !file.isDeclarationFile && !project.program.isSourceFileFromExternalLibrary(file));
	const entrySet = new Set(entries.map(file => path.resolve(file)));
	const candidates = new Map<ts.Symbol, { node: ts.Declaration; name: ts.Identifier; kind: DeadCodeFinding['kind'] }>();
	for (const file of files) {
		walk(file, node => {
			if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isVariableDeclaration(node) || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) || ts.isEnumDeclaration(node)) && node.name && ts.isIdentifier(node.name)) {
				const symbol = resolvedSymbol(project, node.name);
				if (!symbol) { return; }
				let component = false;
				walk(node, child => { if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child) || ts.isJsxFragment(child)) { component = true; } });
				const statement = ts.isVariableDeclaration(node) ? node.parent.parent : node;
				const exported = ts.canHaveModifiers(statement) && ts.getModifiers(statement)?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword);
				if (exported || ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || component || ts.isVariableDeclaration(node) && node.initializer && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) {
					candidates.set(symbol, { node, name: node.name, kind: component ? 'component' : exported ? 'export' : 'function' });
				}
			}
		});
	}
	const edges = new Map<ts.Symbol, Set<ts.Symbol>>(), roots = new Set<ts.Symbol>();
	const moduleEdges = new Map<ts.SourceFile, Set<ts.SourceFile>>();
	for (const file of files) {
		const modules = new Set<ts.SourceFile>(); moduleEdges.set(file, modules);
		walk(file, node => {
			if (ts.isStringLiteralLike(node)) {
				const symbol = project.checker.getSymbolAtLocation(node);
				for (const declaration of symbol?.declarations ?? []) { if (ts.isSourceFile(declaration)) { modules.add(declaration); } }
			}
			if (!ts.isIdentifier(node) || ts.isImportSpecifier(node.parent) || ts.isImportClause(node.parent) || ts.isNamespaceImport(node.parent) || ts.isExportSpecifier(node.parent)) { return; }
			const target = resolvedSymbol(project, node);
			if (!target || !candidates.has(target) || candidates.get(target)!.name === node) { return; }
			let ancestor: ts.Node | undefined = node.parent;
			let owner: ts.Symbol | undefined;
			while (ancestor && !ts.isSourceFile(ancestor)) {
				if ((ts.isFunctionDeclaration(ancestor) || ts.isClassDeclaration(ancestor) || ts.isVariableDeclaration(ancestor) || ts.isInterfaceDeclaration(ancestor) || ts.isTypeAliasDeclaration(ancestor) || ts.isEnumDeclaration(ancestor)) && ancestor.name && ts.isIdentifier(ancestor.name)) {
					const symbol = resolvedSymbol(project, ancestor.name);
					if (symbol && candidates.has(symbol)) {
						if (!ts.isVariableDeclaration(ancestor) || ancestor.initializer && (ts.isArrowFunction(ancestor.initializer) || ts.isFunctionExpression(ancestor.initializer))) { owner = symbol; }
						break;
					}
				}
				ancestor = ancestor.parent;
			}
			if (owner) { const uses = edges.get(owner) ?? new Set<ts.Symbol>(); uses.add(target); edges.set(owner, uses); }
			else { roots.add(target); }
		});
		if (entrySet.has(path.resolve(file.fileName))) {
			const module = project.checker.getSymbolAtLocation(file);
			for (const symbol of module ? project.checker.getExportsOfModule(module) : []) {
				roots.add(symbol.flags & ts.SymbolFlags.Alias ? project.checker.getAliasedSymbol(symbol) : symbol);
			}
		}
	}
	const reachableFiles = new Set<ts.SourceFile>();
	const visitFile = (file: ts.SourceFile): void => { if (reachableFiles.has(file)) { return; } reachableFiles.add(file); for (const dependency of moduleEdges.get(file) ?? []) { visitFile(dependency); } };
	for (const file of files) { if (entrySet.has(path.resolve(file.fileName))) { visitFile(file); } }
	const live = new Set<ts.Symbol>();
	const visit = (symbol: ts.Symbol): void => { if (live.has(symbol)) { return; } live.add(symbol); for (const target of edges.get(symbol) ?? []) { visit(target); } };
	for (const root of roots) { visit(root); }
	return [
		...files.filter(file => !reachableFiles.has(file)).map(file => ({ fileName: file.fileName, start: 0, length: 0, name: path.basename(file.fileName), kind: 'file' as const })),
		...[...candidates].filter(([symbol]) => !live.has(symbol)).map(([, candidate]) => ({ fileName: candidate.node.getSourceFile().fileName, start: candidate.name.getStart(), length: candidate.name.getWidth(), name: candidate.name.text, kind: candidate.kind }))
	];
}
