/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as ts from 'typescript';
import { nodeAt, Project, walk } from './project';
import { Change } from './refactor';

function resolve(project: Project, node: ts.Node): ts.Symbol | undefined {
	const symbol = project.checker.getSymbolAtLocation(node);
	return symbol && symbol.flags & ts.SymbolFlags.Alias ? project.checker.getAliasedSymbol(symbol) : symbol;
}

/** Converts a non-overloaded function and every statically resolved direct caller. */
export function parameterObject(project: Project, fileName: string, offset: number): readonly Change[] {
	const source = project.program.getSourceFile(fileName)!;
	let node: ts.Node = nodeAt(source, offset);
	while (!ts.isFunctionDeclaration(node) && node.parent) { node = node.parent; }
	if (!ts.isFunctionDeclaration(node) || !node.name || !node.body || node.typeParameters?.length || node.parameters.length < 2) {
		throw new Error('Select a named function with at least two required parameters and no type parameters.');
	}
	const fn = node;
	const symbol = resolve(project, fn.name!);
	if (symbol?.declarations?.length !== 1 || fn.parameters.some(parameter => !ts.isIdentifier(parameter.name) || parameter.dotDotDotToken || parameter.questionToken || parameter.initializer || parameter.name.getText() === 'this')) {
		throw new Error('Overloads, destructuring, optional, default, rest and this parameters are not supported.');
	}
	let argumentsUsed = false;
	walk(fn.body!, child => { if (ts.isIdentifier(child) && child.text === 'arguments') { argumentsUsed = true; } });
	if (argumentsUsed) { throw new Error('Functions using arguments cannot be converted safely.'); }
	const names = fn.parameters.map(parameter => parameter.name.getText(source));
	const typed = /\.tsx?$/i.test(fileName);
	const optionsName = `${fn.name!.text}Options`;
	const fields = fn.parameters.map(parameter => `${parameter.name.getText(source)}: ${parameter.type?.getText(source) ?? project.checker.typeToString(project.checker.getTypeAtLocation(parameter))};`).join(' ');
	if (project.checker.getSymbolsInScope(fn, ts.SymbolFlags.Type).some(candidate => candidate.name === optionsName)) { throw new Error('The generated options type name is already in use.'); }
	const changes: Change[] = [
		{ fileName, start: fn.parameters.pos, length: fn.parameters.end - fn.parameters.pos, text: `{ ${names.join(', ')} }${typed ? `: ${optionsName}` : ''}` }
	];
	if (typed) { changes.push({ fileName, start: fn.getStart(source), length: 0, text: `interface ${optionsName} { ${fields} }\n` }); }
	for (const file of project.program.getSourceFiles()) {
		if (file.isDeclarationFile || project.program.isSourceFileFromExternalLibrary(file)) { continue; }
		walk(file, child => {
			if (!ts.isIdentifier(child) || resolve(project, child) !== symbol || child === fn.name) { return; }
			const parent = child.parent;
			if (ts.isImportSpecifier(parent) || ts.isExportSpecifier(parent) || ts.isImportClause(parent)) { return; }
			const expression = ts.isPropertyAccessExpression(parent) && parent.name === child ? parent : child;
			if (!ts.isCallExpression(expression.parent) || expression.parent.expression !== expression || expression.parent.questionDotToken) {
				throw new Error('The function has indirect references. Convert these to direct calls first.');
			}
			const call = expression.parent;
			if (call.arguments.length !== names.length || call.arguments.some(ts.isSpreadElement)) { throw new Error('Every caller must pass exactly the required positional arguments without spreads.'); }
			if (call.arguments.some(argument => { let recursive = false; walk(argument, nested => { if (ts.isIdentifier(nested) && resolve(project, nested) === symbol) { recursive = true; } }); return recursive; })) { throw new Error('Nested calls require separate conversion.'); }
			changes.push({ fileName: file.fileName, start: call.arguments.pos, length: call.arguments.end - call.arguments.pos, text: `{ ${names.map((name, index) => `${name}: ${call.arguments[index].getText(file)}`).join(', ')} }` });
		});
	}
	return changes;
}

type Container = ts.ClassDeclaration | ts.InterfaceDeclaration;
type Member = ts.ClassElement | ts.TypeElement;

function container(node: ts.Node): node is Container { return ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node); }

/** Moves a member only between explicitly related declarations of the same kind. */
export function moveMember(project: Project, fileName: string, offset: number, direction: 'up' | 'down'): readonly Change[] {
	const source = project.program.getSourceFile(fileName)!;
	let node = nodeAt(source, offset);
	while (node.parent && !container(node.parent)) { node = node.parent; }
	if (!node.parent || !container(node.parent) || !('name' in node) || !node.name) { throw new Error('Select a named class or interface member.'); }
	const owner = node.parent;
	const member = node as Member;
	if (owner.typeParameters?.length || ts.isConstructorDeclaration(member) || ts.isIndexSignatureDeclaration(member)) { throw new Error('Generic containers, constructors and index signatures cannot be moved.'); }
	let unsafe = false;
	walk(member, child => { if (child.kind === ts.SyntaxKind.SuperKeyword || ts.isPrivateIdentifier(child) || child.kind === ts.SyntaxKind.OverrideKeyword || child.kind === ts.SyntaxKind.PrivateKeyword) { unsafe = true; } });
	if (unsafe) { throw new Error('Private, override and super-dependent members cannot be moved.'); }
	const bases = (candidate: Container): Container[] => candidate.heritageClauses?.filter(clause => clause.token === ts.SyntaxKind.ExtendsKeyword).flatMap(clause => clause.types.flatMap(type => resolve(project, type.expression)?.declarations?.filter(container) ?? [])) ?? [];
	const targets: Container[] = [];
	if (direction === 'up') { targets.push(...bases(owner)); }
	else {
		for (const file of project.program.getSourceFiles()) {
			if (!file.isDeclarationFile) { walk(file, child => { if (container(child) && bases(child).includes(owner)) { targets.push(child); } }); }
		}
	}
	if (!targets.length || direction === 'up' && targets.length !== 1 || targets.some(target => target.kind !== owner.kind || target.typeParameters?.length || target.getSourceFile().isDeclarationFile)) {
		throw new Error('No unambiguous compatible inheritance target was found.');
	}
	const name = member.name!.getText(source);
	if (targets.some(target => target.members.some(existing => existing.name?.getText() === name))) { throw new Error('A destination already declares this member.'); }
	return [
		{ fileName, start: member.getFullStart(), length: member.end - member.getFullStart(), text: '' },
		...targets.map(target => ({ fileName: target.getSourceFile().fileName, start: target.end - 1, length: 0, text: `\n${member.getFullText(source)}\n` }))
	];
}

/** Rejects refactorings that introduce new compiler errors, including missing imports. */
export function validateChanges(project: Project, changes: readonly Change[]): void {
	const options = project.program.getCompilerOptions();
	const host = ts.createCompilerHost(options);
	const normalize = (file: string) => ts.sys.useCaseSensitiveFileNames ? file.replace(/\\/g, '/') : file.replace(/\\/g, '/').toLowerCase();
	const content = new Map(project.program.getSourceFiles().map(file => [normalize(file.fileName), file.text]));
	for (const fileName of new Set(changes.map(change => change.fileName))) {
		let text = content.get(normalize(fileName))!;
		const ordered = changes.filter(change => change.fileName === fileName).sort((a, b) => b.start - a.start);
		for (let index = 0; index < ordered.length; index++) {
			const change = ordered[index];
			if (index && change.start + change.length > ordered[index - 1].start) { throw new Error('The refactoring contains overlapping edits.'); }
			text = text.slice(0, change.start) + change.text + text.slice(change.start + change.length);
		}
		content.set(normalize(fileName), text);
	}
	const read = host.readFile;
	host.readFile = file => content.get(normalize(file)) ?? read(file);
	const updated = ts.createProgram(project.program.getRootFileNames(), options, host);
	const signature = (diagnostic: ts.Diagnostic) => `${diagnostic.file?.fileName}:${diagnostic.code}:${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`;
	const existing = new Map<string, number>();
	for (const diagnostic of ts.getPreEmitDiagnostics(project.program)) { const key = signature(diagnostic); existing.set(key, (existing.get(key) ?? 0) + 1); }
	for (const diagnostic of ts.getPreEmitDiagnostics(updated)) {
		if (diagnostic.category !== ts.DiagnosticCategory.Error) { continue; }
		const key = signature(diagnostic);
		const count = existing.get(key) ?? 0;
		if (count) { existing.set(key, count - 1); } else { throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')); }
	}
}
