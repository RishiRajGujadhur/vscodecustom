/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as ts from 'typescript';
import * as path from 'node:path';
import { Project, nodeAt, resolvedSymbol, walk } from './project';
import { Change } from './refactor';
import { validateChanges } from './globalRefactor';

export type DeleteRisk = 'external' | 'dynamic' | 'sideEffects' | 'unsupported';
export interface DeleteUsage { readonly fileName: string; readonly start: number; readonly length: number; readonly kind: 'blocking' | 'removable' }
export interface DeletePlan {
	readonly name: string;
	readonly usages: readonly DeleteUsage[];
	readonly risks: readonly DeleteRisk[];
	readonly changes: readonly Change[];
	readonly files: readonly { fileName: string; documentText: string }[];
}
function replacement(node: ts.Node, text: string): Change { return { fileName: node.getSourceFile().fileName, start: node.getStart(), length: node.getWidth(), text, documentText: node.getSourceFile().text }; }
function importEdit(declaration: ts.ImportSpecifier | ts.ImportClause | ts.NamespaceImport, preserveEvaluation: boolean): Change {
	let node: ts.Node = declaration;
	while (!ts.isImportDeclaration(node) && node.parent) { node = node.parent; }
	if (!ts.isImportDeclaration(node) || !node.importClause) { throw new Error('import'); }
	const clause = node.importClause;
	let defaultName = clause.name?.text;
	let named = clause.namedBindings;
	if (ts.isImportClause(declaration)) { defaultName = undefined; }
	if (ts.isNamespaceImport(declaration)) { named = undefined; }
	let namedText = named?.getText() ?? '';
	if (ts.isImportSpecifier(declaration) && named && ts.isNamedImports(named)) {
		const others = named.elements.filter(element => element !== declaration);
		namedText = others.length ? `{ ${others.map(element => element.getText()).join(', ')} }` : '';
	}
	const names = [defaultName, namedText].filter(Boolean).join(', ');
	return replacement(node, names ? `import ${clause.isTypeOnly ? 'type ' : ''}${names} from ${node.moduleSpecifier.getText()}${node.attributes ? ' ' + node.attributes.getText() : ''};` : clause.isTypeOnly || !preserveEvaluation ? '' : `import ${node.moduleSpecifier.getText()}${node.attributes ? ' ' + node.attributes.getText() : ''};`);
}
function effectFree(node: ts.Expression): boolean {
	if (ts.isStringLiteral(node) || ts.isNumericLiteral(node) || ts.isArrowFunction(node) || ts.isFunctionExpression(node) || [ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword, ts.SyntaxKind.NullKeyword].includes(node.kind)) { return true; }
	if (ts.isArrayLiteralExpression(node)) { return node.elements.every(element => ts.isExpression(element) && effectFree(element)); }
	return ts.isObjectLiteralExpression(node) && node.properties.every(property => ts.isPropertyAssignment(property) && !ts.isComputedPropertyName(property.name) && effectFree(property.initializer) || ts.isMethodDeclaration(property) && !ts.isComputedPropertyName(property.name));
}

/** Plans only the target declaration and unused imports, never dependent executable logic. */
export function safeDelete(project: Project, fileName: string, offset: number): DeletePlan {
	const source = project.program.getSourceFile(fileName)!;
	const selected = nodeAt(source, offset);
	const binding = ts.isImportSpecifier(selected.parent) ? selected.parent.name : selected;
	const raw = project.checker.getSymbolAtLocation(binding);
	const importAlias = raw?.declarations?.some(declaration => ts.isImportSpecifier(declaration) || ts.isImportClause(declaration) || ts.isNamespaceImport(declaration));
	const symbol = importAlias ? raw : resolvedSymbol(project, selected);
	const declarations = symbol?.declarations ?? [];
	const risks = new Set<DeleteRisk>();
	const changes: Change[] = [];
	const usages: DeleteUsage[] = [];
	const preserveEvaluation = !!project.program.getCompilerOptions().verbatimModuleSyntax;
	if (!symbol || !declarations.length || declarations.some(declaration => declaration.getSourceFile().isDeclarationFile)) { return { name: selected.getText(), risks: ['unsupported'], usages: [], changes: [], files: [] }; }
	const contains = (file: string, start: number) => declarations.some(declaration => declaration.getSourceFile().fileName === file && declaration.getStart() <= start && start < declaration.end);
	for (const declaration of declarations) {
		if (ts.isVariableDeclaration(declaration)) {
			const list = declaration.parent;
			if (!ts.isVariableDeclarationList(list) || !ts.isVariableStatement(list.parent) || !ts.isIdentifier(declaration.name)) { risks.add('unsupported'); continue; }
			if (declaration.initializer && !effectFree(declaration.initializer)) { risks.add('sideEffects'); }
			changes.push(list.declarations.length === 1 ? replacement(list.parent, '') : replacement(list, `${list.flags & ts.NodeFlags.Const ? 'const' : list.flags & ts.NodeFlags.Let ? 'let' : 'var'} ${list.declarations.filter(other => other !== declaration).map(other => other.getText()).join(', ')}`));
		} else if (ts.isImportSpecifier(declaration) || ts.isImportClause(declaration) || ts.isNamespaceImport(declaration)) { changes.push(importEdit(declaration, preserveEvaluation)); }
		else if (ts.isFunctionDeclaration(declaration) || ts.isClassDeclaration(declaration) || ts.isInterfaceDeclaration(declaration) || ts.isTypeAliasDeclaration(declaration) || ts.isMethodDeclaration(declaration) || ts.isPropertyDeclaration(declaration) || ts.isMethodSignature(declaration) || ts.isPropertySignature(declaration) || ts.isGetAccessorDeclaration(declaration) || ts.isSetAccessorDeclaration(declaration)) {
			if (ts.canHaveDecorators(declaration) && ts.getDecorators(declaration)?.length || ts.isClassDeclaration(declaration) && (declaration.heritageClauses?.length || declaration.members.some(member => ts.isClassStaticBlockDeclaration(member) || ts.isPropertyDeclaration(member) && !!member.initializer))) { risks.add('sideEffects'); }
			if (ts.isPropertyDeclaration(declaration) && declaration.initializer && !effectFree(declaration.initializer)) { risks.add('sideEffects'); }
			if ((ts.isMethodDeclaration(declaration) || ts.isPropertyDeclaration(declaration) || ts.isMethodSignature(declaration) || ts.isPropertySignature(declaration) || ts.isGetAccessorDeclaration(declaration) || ts.isSetAccessorDeclaration(declaration))) {
				if (!ts.isPrivateIdentifier(declaration.name)) { risks.add('dynamic'); }
				if (ts.isComputedPropertyName(declaration.name)) { risks.add('sideEffects'); }
			}
			changes.push(replacement(declaration, ''));
		} else { risks.add('unsupported'); }
		let scope: ts.Node | undefined = declaration;
		while (scope && !ts.isSourceFile(scope)) {
			if (ts.canHaveModifiers(scope) && ts.getModifiers(scope)?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword || modifier.kind === ts.SyntaxKind.DefaultKeyword)) { risks.add('external'); }
			scope = scope.parent;
		}
		if (!ts.isExternalModule(declaration.getSourceFile()) && ts.isSourceFile(declaration.parent)) { risks.add('external'); }
	}
	const seen = new Set<string>();
	for (const declaration of declarations) {
		const name = ts.getNameOfDeclaration(declaration);
		if (!name) { continue; }
		for (const group of project.service.findReferences(declaration.getSourceFile().fileName, name.getStart()) ?? []) {
			for (const reference of group.references) {
				if (contains(reference.fileName, reference.textSpan.start)) { continue; }
				const file = project.program.getSourceFile(reference.fileName);
				if (!file || file.isDeclarationFile) { risks.add('external'); continue; }
				const node = nodeAt(file, reference.textSpan.start);
				if (importAlias && project.checker.getSymbolAtLocation(node) !== symbol) { continue; }
				const key = `${reference.fileName}:${reference.textSpan.start}`;
				if (seen.has(key)) { continue; } seen.add(key);
				const parent = node.parent;
				const removable = ts.isImportSpecifier(parent) || ts.isImportClause(parent) || ts.isNamespaceImport(parent);
				usages.push({ fileName: reference.fileName, start: reference.textSpan.start, length: reference.textSpan.length, kind: removable ? 'removable' : 'blocking' });
				if (removable) { changes.push(importEdit(parent, preserveEvaluation)); }
			}
		}
	}
	for (const file of project.program.getSourceFiles()) {
		if (file.isDeclarationFile || project.program.isSourceFileFromExternalLibrary(file)) { continue; }
		walk(file, node => {
			if (ts.isCallExpression(node) && ['eval', 'Function', 'Reflect.get', 'Reflect.set'].includes(node.expression.getText()) || ts.isElementAccessExpression(node) && !ts.isStringLiteralLike(node.argumentExpression)) { risks.add('dynamic'); }
			if (ts.isStringLiteralLike(node) && node.text === symbol.name) { risks.add('dynamic'); }
			if (ts.isExportSpecifier(node) && resolvedSymbol(project, node.name) === (importAlias ? resolvedSymbol(project, selected) : symbol)) { risks.add('external'); }
		});
	}
	// Coalesce repeated import references before validating, but refuse competing rewrites.
	const unique = new Map<string, Change>();
	for (const change of changes) {
		const key = `${change.fileName}:${change.start}:${change.length}`;
		if (unique.has(key) && unique.get(key)!.text !== change.text) { risks.add('unsupported'); }
		unique.set(key, change);
	}
	const edits = [...unique.values()];
	if (!usages.some(usage => usage.kind === 'blocking') && !risks.has('unsupported') && !risks.has('sideEffects')) { validateChanges(project, edits, new Map(), true); }
	return { name: symbol.name, usages, risks: [...risks], changes: edits, files: [] };
}

/** Module deletion is always uncertain about entry points outside this compiler project. */
export function safeDeleteFile(project: Project, fileName: string): DeletePlan {
	const source = project.program.getSourceFile(fileName)!;
	const usages: DeleteUsage[] = [];
	const target = project.checker.getSymbolAtLocation(source);
	for (const file of project.program.getSourceFiles()) {
		if (file === source || file.isDeclarationFile || project.program.isSourceFileFromExternalLibrary(file)) { continue; }
		walk(file, node => {
			if (ts.isStringLiteralLike(node)) {
				const resolved = ts.resolveModuleName(node.text, file.fileName, project.program.getCompilerOptions(), ts.sys).resolvedModule?.resolvedFileName;
				if (target && project.checker.getSymbolAtLocation(node) === target || resolved && path.resolve(resolved).toLowerCase() === path.resolve(fileName).toLowerCase()) { usages.push({ fileName: file.fileName, start: node.getStart(), length: node.getWidth(), kind: 'blocking' }); }
			}
		});
		if (file.referencedFiles.some(reference => path.resolve(path.dirname(file.fileName), reference.fileName).toLowerCase() === path.resolve(fileName).toLowerCase())) { usages.push({ fileName: file.fileName, start: 0, length: 0, kind: 'blocking' }); }
	}
	return { name: fileName, usages, risks: ['external'], changes: [], files: [{ fileName, documentText: source.text }] };
}
