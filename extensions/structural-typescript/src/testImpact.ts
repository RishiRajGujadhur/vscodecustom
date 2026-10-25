/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as ts from 'typescript';
import * as path from 'node:path';
import { Project, nodeAt, resolvedSymbol, walk } from './project';
import { canonicalFileName, projectModuleGraph } from './projectGraph';

export interface ImpactTarget { readonly fileName: string; readonly offset?: number }
export interface ImpactStep { readonly fileName: string; readonly start: number; readonly name: string; readonly kind?: 'file' }
export interface ImpactedTest extends ImpactStep { readonly chain: readonly ImpactStep[] }
export interface TestImpactResult { readonly tests: readonly ImpactedTest[]; readonly excludedFiles: readonly string[] }

function ownerSymbol(project: Project, node: ts.Node): ts.Symbol | undefined {
	if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isVariableDeclaration(node) || ts.isMethodDeclaration(node) || ts.isPropertyDeclaration(node) || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node) || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) || ts.isEnumDeclaration(node)) && node.name) {
		return resolvedSymbol(project, node.name);
	}
	return undefined;
}

/** Finds static test cases through reverse symbol references or conservative module dependencies. */
export function analyzeTestImpact(project: Project, targets: readonly ImpactTarget[]): TestImpactResult {
	const { files, dependencies } = projectModuleGraph(project);
	const byName = new Map(files.map(file => [canonicalFileName(file.fileName), file]));
	const registrations = new Map<ts.CallExpression, ImpactStep>();
	const testsByFile = new Map<ts.SourceFile, ImpactStep[]>();
	const callsByFile = new Map<ts.SourceFile, ts.CallExpression[]>();
	for (const file of files) {
		let testFile = /(?:^|[\\/])(?:__tests__|tests?)[\\/]|[.-](?:test|spec)\.[cm]?[jt]sx?$/.test(file.fileName);
		const importedBindings = new Set<ts.Declaration>();
		const namespaces = new Set<string>();
		const aliases = new Map([['test', 'test'], ['it', 'test'], ['describe', 'suite'], ['suite', 'suite']]);
		for (const statement of file.statements) {
			if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) || !/^(node:test|vitest|@jest\/globals|@playwright\/test|mocha)$/.test(statement.moduleSpecifier.text)) { continue; }
			testFile = true;
			const bindings = statement.importClause?.namedBindings;
			if (bindings && ts.isNamedImports(bindings)) {
				for (const element of bindings.elements) { const kind = aliases.get((element.propertyName ?? element.name).text); if (kind) { aliases.set(element.name.text, kind); importedBindings.add(element); } }
			}
			if (bindings && ts.isNamespaceImport(bindings)) { namespaces.add(bindings.name.text); importedBindings.add(bindings); }
			if (statement.importClause?.name && statement.moduleSpecifier.text === 'node:test') { aliases.set(statement.importClause.name.text, 'test'); importedBindings.add(statement.importClause); }
		}
		const registrationKind = (expression: ts.Expression): string | undefined => {
			if (ts.isIdentifier(expression)) {
				const symbol = project.checker.getSymbolAtLocation(expression);
				if (symbol?.declarations?.some(declaration => !declaration.getSourceFile().isDeclarationFile && !importedBindings.has(declaration))) { return undefined; }
				return aliases.get(expression.text);
			}
			if (ts.isCallExpression(expression)) { return registrationKind(expression.expression); }
			if (ts.isPropertyAccessExpression(expression)) {
				if (['only', 'skip', 'todo', 'each', 'concurrent', 'serial'].includes(expression.name.text)) { return registrationKind(expression.expression); }
				if (ts.isIdentifier(expression.expression) && namespaces.has(expression.expression.text) && project.checker.getSymbolAtLocation(expression.expression)?.declarations?.every(declaration => importedBindings.has(declaration)) || registrationKind(expression.expression)) { return aliases.get(expression.name.text); }
				if (expression.name.text === 'test' && ts.isIdentifier(expression.expression)) {
					for (const declaration of project.checker.getSymbolAtLocation(expression.expression)?.declarations ?? []) {
						if (ts.isParameter(declaration) && ts.isFunctionLike(declaration.parent) && declaration.parent.parameters[0] === declaration && ts.isCallExpression(declaration.parent.parent) && registrationKind(declaration.parent.parent.expression) === 'test') { return 'test'; }
					}
				}
				return undefined;
			}
			return undefined;
		};
		const title = (call: ts.CallExpression) => call.arguments[0] && ts.isStringLiteralLike(call.arguments[0]) ? call.arguments[0].text : undefined;
		const cases: ImpactStep[] = [];
		const calls: ts.CallExpression[] = []; callsByFile.set(file, calls);
		walk(file, node => {
			if (!testFile || !ts.isCallExpression(node) || registrationKind(node.expression) !== 'test' || ts.isCallExpression(node.parent) && node.parent.expression === node) { return; }
			if (title(node) === undefined) {
				let fallback = cases.find(test => test.kind === 'file');
				if (!fallback) { fallback = { fileName: file.fileName, start: 0, name: path.basename(file.fileName), kind: 'file' }; cases.push(fallback); }
				registrations.set(node, fallback); calls.push(node); return;
			}
			const names = [title(node)!];
			for (let parent = node.parent; parent; parent = parent.parent) {
				if (ts.isCallExpression(parent) && registrationKind(parent.expression) === 'suite' && title(parent) !== undefined) { names.unshift(title(parent)!); }
			}
			const step = { fileName: file.fileName, start: node.getStart(), name: names.join(' › ') };
			registrations.set(node, step); cases.push(step); calls.push(node);
		});
		if (testFile) {
			testsByFile.set(file, cases.length ? cases : [{ fileName: file.fileName, start: 0, name: path.basename(file.fileName), kind: 'file' }]);
		}
	}
	const moduleUsers = new Map<ts.SourceFile, Set<ts.SourceFile>>();
	for (const [file, imports] of dependencies) {
		for (const dependency of imports) { const users = moduleUsers.get(dependency) ?? new Set<ts.SourceFile>(); users.add(file); moduleUsers.set(dependency, users); }
	}
	const symbolUsers = new Map<ts.Symbol, Set<ts.Symbol>>();
	const testUsers = new Map<ts.Symbol, Set<ts.CallExpression>>();
	for (const file of files) {
		walk(file, node => {
			if (!ts.isIdentifier(node) || ts.isImportSpecifier(node.parent) || ts.isImportClause(node.parent) || ts.isNamespaceImport(node.parent) || ts.isExportSpecifier(node.parent)) { return; }
			const symbol = resolvedSymbol(project, node);
			if (!symbol) { return; }
			let owned = false;
			for (let parent = node.parent; parent && !ts.isSourceFile(parent); parent = parent.parent) {
				if (ts.isCallExpression(parent) && registrations.has(parent)) {
					const users = testUsers.get(symbol) ?? new Set<ts.CallExpression>(); users.add(parent); testUsers.set(symbol, users); owned = true; break;
				}
				const owner = ownerSymbol(project, parent);
				if (!owner) { continue; }
				const users = symbolUsers.get(symbol) ?? new Set<ts.Symbol>(); users.add(owner); symbolUsers.set(symbol, users);
				// Initializers execute even when their assigned value is never read.
				if (ts.isPropertyDeclaration(parent) || ts.isVariableDeclaration(parent) && parent.initializer && !ts.isArrowFunction(parent.initializer) && !ts.isFunctionExpression(parent.initializer) && !ts.isClassExpression(parent.initializer)) { continue; }
				owned = true; break;
			}
			// Shared hooks and module initialization can affect every case in a test file.
			if (!owned && callsByFile.get(file)?.length) {
				const users = testUsers.get(symbol) ?? new Set<ts.CallExpression>();
				for (const call of callsByFile.get(file)!) { users.add(call); }
				testUsers.set(symbol, users);
			}
		});
	}
	const found = new Map<string, ImpactedTest>();
	const add = (test: ImpactStep, chain: readonly ImpactStep[]) => found.set(`${canonicalFileName(test.fileName)}:${test.start}:${test.kind ?? 'case'}`, { ...test, chain });
	const excludedFiles: string[] = [];
	for (const target of targets) {
		const source = byName.get(canonicalFileName(target.fileName));
		if (!source) { excludedFiles.push(target.fileName); continue; }
		if (target.offset === undefined) {
			const chains = new Map<ts.SourceFile, readonly ImpactStep[]>([[source, [{ fileName: source.fileName, start: 0, name: path.basename(source.fileName) }]]]);
			for (const [file, chain] of chains) {
				for (const test of testsByFile.get(file) ?? []) { add(test, [...chain, test]); }
				for (const user of moduleUsers.get(file) ?? []) { if (!chains.has(user)) { chains.set(user, [...chain, { fileName: user.fileName, start: 0, name: path.basename(user.fileName) }]); } }
			}
		} else {
			let node: ts.Node | undefined = nodeAt(source, target.offset);
			let symbol = ts.isIdentifier(node) ? resolvedSymbol(project, node) : undefined;
			while (!symbol && node) { symbol = ownerSymbol(project, node); node = node.parent; }
			if (!symbol) { continue; }
			const step = (candidate: ts.Symbol): ImpactStep => { const declaration = candidate.valueDeclaration ?? candidate.declarations?.[0]; return { fileName: declaration?.getSourceFile().fileName ?? source.fileName, start: declaration?.getStart() ?? 0, name: candidate.name }; };
			const chains = new Map<ts.Symbol, readonly ImpactStep[]>([[symbol, [step(symbol)]]]);
			for (const [dependency, chain] of chains) {
				for (const call of testUsers.get(dependency) ?? []) { const test = registrations.get(call)!; add(test, [...chain, test]); }
				for (const user of symbolUsers.get(dependency) ?? []) {
					if (!chains.has(user)) { chains.set(user, [...chain, step(user)]); }
				}
			}
		}
	}
	return { tests: [...found.values()].sort((a, b) => a.fileName.localeCompare(b.fileName) || a.start - b.start), excludedFiles };
}
