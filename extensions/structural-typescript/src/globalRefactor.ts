/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as ts from 'typescript';
import * as path from 'node:path';
import { nodeAt, Project, resolvedSymbol as resolve, walk } from './project';
import { Change } from './refactor';
import { RefactorError } from './errors';

function directCalls(project: Project, fn: ts.FunctionDeclaration): ts.CallExpression[] {
	const symbol = resolve(project, fn.name!);
	const calls: ts.CallExpression[] = [];
	for (const file of project.program.getSourceFiles()) {
		if (file.isDeclarationFile || project.program.isSourceFileFromExternalLibrary(file)) { continue; }
		walk(file, child => {
			if (!ts.isIdentifier(child) || resolve(project, child) !== symbol || child === fn.name) { return; }
			const parent = child.parent;
			if (ts.isImportSpecifier(parent) || ts.isExportSpecifier(parent) || ts.isImportClause(parent)) { return; }
			const expression = ts.isPropertyAccessExpression(parent) && parent.name === child ? parent : child;
			if (!ts.isCallExpression(expression.parent) || expression.parent.expression !== expression || expression.parent.questionDotToken) { throw new RefactorError('indirectReference'); }
			calls.push(expression.parent);
		});
	}
	return calls;
}

/** Converts a non-overloaded function and every statically resolved direct caller. */
export function parameterObject(project: Project, fileName: string, offset: number): readonly Change[] {
	const source = project.program.getSourceFile(fileName)!;
	let node: ts.Node = nodeAt(source, offset);
	while (!ts.isFunctionDeclaration(node) && node.parent) { node = node.parent; }
	if (!ts.isFunctionDeclaration(node) || !node.name || !node.body || node.typeParameters?.length || node.parameters.length < 2) {
		throw new RefactorError('unsupportedFunction');
	}
	const fn = node;
	const symbol = resolve(project, fn.name!);
	if (symbol?.declarations?.length !== 1 || fn.parameters.some(parameter => !ts.isIdentifier(parameter.name) || parameter.dotDotDotToken || parameter.questionToken || parameter.initializer || parameter.name.getText() === 'this')) {
		throw new RefactorError('unsupportedParameters');
	}
	let argumentsUsed = false;
	walk(fn.body!, child => { if (ts.isIdentifier(child) && child.text === 'arguments') { argumentsUsed = true; } });
	if (argumentsUsed) { throw new RefactorError('argumentsReference'); }
	const names = fn.parameters.map(parameter => parameter.name.getText(source));
	const typed = /\.tsx?$/i.test(fileName);
	const optionsName = `${fn.name!.text}Options`;
	const fields = fn.parameters.map(parameter => `${parameter.name.getText(source)}: ${parameter.type?.getText(source) ?? project.checker.typeToString(project.checker.getTypeAtLocation(parameter))};`).join(' ');
	if (project.checker.getSymbolsInScope(fn, ts.SymbolFlags.Type).some(candidate => candidate.name === optionsName)) { throw new RefactorError('optionsConflict'); }
	const changes: Change[] = [
		{ fileName, start: fn.parameters.pos, length: fn.parameters.end - fn.parameters.pos, text: `{ ${names.join(', ')} }${typed ? `: ${optionsName}` : ''}` }
	];
	if (typed) { changes.push({ fileName, start: fn.getStart(source), length: 0, text: `interface ${optionsName} { ${fields} }\n` }); }
	for (const call of directCalls(project, fn)) {
		const file = call.getSourceFile();
		if (call.arguments.length !== names.length || call.arguments.some(ts.isSpreadElement)) { throw new RefactorError('invalidCaller'); }
		if (call.arguments.some(argument => { let recursive = false; walk(argument, nested => { if (ts.isIdentifier(nested) && resolve(project, nested) === symbol) { recursive = true; } }); return recursive; })) { throw new RefactorError('nestedCall'); }
		changes.push({ fileName: file.fileName, start: call.arguments.pos, length: call.arguments.end - call.arguments.pos, text: `{ ${names.map((name, index) => `${name}: ${call.arguments[index].getText(file)}`).join(', ')} }` });
	}
	return changes;
}

/** Reverses object-parameter extraction when literal callers preserve evaluation order. */
export function inlineParameterObject(project: Project, fileName: string, offset: number): readonly Change[] {
	const source = project.program.getSourceFile(fileName)!;
	let node = nodeAt(source, offset);
	while (!ts.isFunctionDeclaration(node) && node.parent) { node = node.parent; }
	if (!ts.isFunctionDeclaration(node) || !node.name || !node.body || node.typeParameters?.length || node.parameters.length !== 1) { throw new RefactorError('unsupportedObjectParameter'); }
	const fn = node;
	const parameter = fn.parameters[0];
	if (!ts.isObjectBindingPattern(parameter.name) || parameter.initializer || parameter.questionToken || parameter.name.elements.some(element => !ts.isIdentifier(element.name) || element.propertyName || element.initializer || element.dotDotDotToken)
		|| resolve(project, fn.name!)?.declarations?.length !== 1) { throw new RefactorError('unsupportedObjectParameter'); }
	let argumentsUsed = false;
	walk(fn.body!, child => { if (ts.isIdentifier(child) && child.text === 'arguments') { argumentsUsed = true; } });
	if (argumentsUsed) { throw new RefactorError('argumentsReference'); }
	const typed = /\.tsx?$/i.test(fileName);
	const type = project.checker.getTypeAtLocation(parameter);
	const names = parameter.name.elements.map(element => element.name.getText(source));
	const fields = names.map(name => {
		const property = type.getProperty(name)?.declarations?.[0];
		if (typed && (!property || !ts.isPropertySignature(property) || !property.type || property.questionToken || !ts.isIdentifier(property.name))) { throw new RefactorError('unsupportedObjectParameter'); }
		return `${name}${typed && property && ts.isPropertySignature(property) ? `: ${property.type!.getText()}` : ''}`;
	});
	const changes: Change[] = [{ fileName, start: fn.parameters.pos, length: fn.parameters.end - fn.parameters.pos, text: fields.join(', ') }];
	for (const call of directCalls(project, fn)) {
		const argument = call.arguments[0];
		if (call.arguments.length !== 1 || !argument || !ts.isObjectLiteralExpression(argument) || argument.properties.length !== names.length) { throw new RefactorError('objectCallerOrder'); }
		const values = argument.properties.map((property, index) => {
			if ((!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) || !ts.isIdentifier(property.name) || property.name.text !== names[index]) { throw new RefactorError('objectCallerOrder'); }
			return ts.isPropertyAssignment(property) ? property.initializer.getText() : property.name.getText();
		});
		changes.push({ fileName: call.getSourceFile().fileName, start: call.arguments.pos, length: call.arguments.end - call.arguments.pos, text: values.join(', ') });
	}
	if (parameter.type && ts.isTypeReferenceNode(parameter.type)) {
		const declaration = resolve(project, parameter.type.typeName)?.declarations?.[0];
		if (declaration && ts.isInterfaceDeclaration(declaration) && declaration.getSourceFile() === source && !declaration.modifiers?.length && !declaration.heritageClauses?.length && !declaration.typeParameters?.length) {
			const references = project.service.findReferences(fileName, declaration.name.getStart());
			if (references?.flatMap(group => group.references).every(reference => reference.isDefinition || reference.fileName.replace(/\\/g, '/') === source.fileName.replace(/\\/g, '/') && parameter.type!.getStart() <= reference.textSpan.start && reference.textSpan.start < parameter.type!.end)) {
				changes.push({ fileName, start: declaration.getFullStart(), length: declaration.end - declaration.getFullStart(), text: '' });
			}
		}
	}
	return changes;
}

type Container = ts.ClassDeclaration | ts.InterfaceDeclaration;
type Member = ts.ClassElement | ts.TypeElement;

function container(node: ts.Node): node is Container { return ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node); }

function memberImports(project: Project, member: Member, destination: ts.SourceFile): Change[] {
	const source = member.getSourceFile();
	if (source === destination) { return []; }
	const used = new Set<ts.Symbol>();
	walk(member, node => { if (ts.isIdentifier(node)) { const symbol = project.checker.getSymbolAtLocation(node); if (symbol) { used.add(symbol); } } });
	const existing = new Map<string, ts.Symbol>();
	for (const statement of destination.statements) {
		if (ts.isImportDeclaration(statement)) {
			walk(statement, node => { if (ts.isIdentifier(node)) { const symbol = resolve(project, node); if (symbol) { existing.set(node.text, symbol); } } });
		}
	}
	const needed = (identifier: ts.Identifier): boolean => {
		const symbol = project.checker.getSymbolAtLocation(identifier);
		return !!symbol && used.has(symbol) && existing.get(identifier.text) !== resolve(project, identifier);
	};
	const imports: string[] = [];
	const printer = ts.createPrinter();
	for (const statement of source.statements) {
		if (!ts.isImportDeclaration(statement) || !statement.importClause || !ts.isStringLiteral(statement.moduleSpecifier)) { continue; }
		const clause = statement.importClause;
		const defaultName = clause.name && needed(clause.name) ? clause.name : undefined;
		const bindings = clause.namedBindings;
		const namedBindings = bindings && ts.isNamedImports(bindings) ? ts.factory.updateNamedImports(bindings, bindings.elements.filter(element => needed(element.name))) : bindings && needed(bindings.name) ? bindings : undefined;
		if (!defaultName && (!namedBindings || ts.isNamedImports(namedBindings) && !namedBindings.elements.length)) { continue; }
		let specifier = statement.moduleSpecifier.text;
		if (specifier.startsWith('.')) {
			specifier = path.relative(path.dirname(destination.fileName), path.resolve(path.dirname(source.fileName), specifier)).replace(/\\/g, '/');
			if (!specifier.startsWith('.')) { specifier = `./${specifier}`; }
		}
		const updated = ts.factory.updateImportDeclaration(statement, statement.modifiers, ts.factory.updateImportClause(clause, clause.isTypeOnly, defaultName, namedBindings), ts.factory.createStringLiteral(specifier), statement.attributes);
		imports.push(printer.printNode(ts.EmitHint.Unspecified, updated, source));
	}
	if (!imports.length) { return []; }
	const insertion = destination.statements.find(statement => !ts.isImportDeclaration(statement) && !(ts.isExpressionStatement(statement) && ts.isStringLiteral(statement.expression)))?.getStart() ?? destination.end;
	return [{ fileName: destination.fileName, start: insertion, length: 0, text: `${imports.join('\n')}\n` }];
}

/** Moves a member only between explicitly related declarations of the same kind. */
export function moveMember(project: Project, fileName: string, offset: number, direction: 'up' | 'down'): readonly Change[] {
	const source = project.program.getSourceFile(fileName)!;
	let node = nodeAt(source, offset);
	while (node.parent && !container(node.parent)) { node = node.parent; }
	if (!node.parent || !container(node.parent) || !('name' in node) || !node.name) { throw new RefactorError('invalidMember'); }
	const owner = node.parent;
	const member = node as Member;
	if (owner.typeParameters?.length || ts.isConstructorDeclaration(member) || ts.isIndexSignatureDeclaration(member)) { throw new RefactorError('genericMember'); }
	if (ts.isPropertyDeclaration(member) && member.initializer || ts.canHaveDecorators(member) && ts.getDecorators(member)?.length) { throw new RefactorError('unsafeMember'); }
	let unsafe = false;
	walk(member, child => { if (child.kind === ts.SyntaxKind.SuperKeyword || ts.isPrivateIdentifier(child) || child.kind === ts.SyntaxKind.OverrideKeyword || child.kind === ts.SyntaxKind.PrivateKeyword) { unsafe = true; } });
	if (unsafe) { throw new RefactorError('unsafeMember'); }
	const bases = (candidate: Container): Container[] => candidate.heritageClauses?.filter(clause => clause.token === ts.SyntaxKind.ExtendsKeyword).flatMap(clause => clause.types.flatMap(type => resolve(project, type.expression)?.declarations?.filter(container) ?? [])) ?? [];
	const targets: Container[] = [];
	if (direction === 'up') { targets.push(...bases(owner)); }
	else {
		for (const file of project.program.getSourceFiles()) {
			if (!file.isDeclarationFile) { walk(file, child => { if (container(child) && bases(child).includes(owner)) { targets.push(child); } }); }
		}
	}
	if (!targets.length || direction === 'up' && targets.length !== 1 || targets.some(target => target.kind !== owner.kind || target.typeParameters?.length || target.getSourceFile().isDeclarationFile)) {
		throw new RefactorError('invalidTarget');
	}
	const name = member.name!.getText(source);
	if (targets.some(target => target.members.some(existing => existing.name?.getText() === name))) { throw new RefactorError('existingMember'); }
	return [
		{ fileName, start: member.getFullStart(), length: member.end - member.getFullStart(), text: '' },
		...targets.flatMap(target => [
			...memberImports(project, member, target.getSourceFile()),
			{ fileName: target.getSourceFile().fileName, start: target.end - 1, length: 0, text: `\n${member.getFullText(source)}\n` }
		])
	];
}

/** Rejects refactorings that introduce new compiler errors, including missing imports. */
export function validateChanges(project: Project, changes: readonly Change[], newFiles: ReadonlyMap<string, string> = new Map(), ignoreUnused = false): void {
	const options = project.program.getCompilerOptions();
	const host = ts.createCompilerHost(options);
	host.getCurrentDirectory = () => project.directory;
	const normalize = (file: string) => ts.sys.useCaseSensitiveFileNames ? file.replace(/\\/g, '/') : file.replace(/\\/g, '/').toLowerCase();
	const content = new Map(project.program.getSourceFiles().map(file => [normalize(file.fileName), file.text]));
	for (const [file, text] of newFiles) { content.set(normalize(file), text); }
	for (const fileName of new Set(changes.map(change => change.fileName))) {
		let text = content.get(normalize(fileName)) ?? ts.sys.readFile(fileName);
		if (text === undefined) { throw new RefactorError('missingSource'); }
		const ordered = changes.filter(change => change.fileName === fileName).sort((a, b) => b.start - a.start);
		for (let index = 0; index < ordered.length; index++) {
			const change = ordered[index];
			if (index && change.start + change.length > ordered[index - 1].start) { throw new RefactorError('overlappingEdits'); }
			text = text.slice(0, change.start) + change.text + text.slice(change.start + change.length);
		}
		content.set(normalize(fileName), text);
	}
	const read = host.readFile;
	host.readFile = file => content.get(normalize(file)) ?? read(file);
	const exists = host.fileExists;
	host.fileExists = file => content.has(normalize(file)) || exists(file);
	const updated = ts.createProgram([...project.program.getRootFileNames(), ...newFiles.keys()], options, host);
	const signature = (diagnostic: ts.Diagnostic) => `${diagnostic.file?.fileName}:${diagnostic.code}:${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`;
	const existing = new Map<string, number>();
	for (const diagnostic of ts.getPreEmitDiagnostics(project.program)) { const key = signature(diagnostic); existing.set(key, (existing.get(key) ?? 0) + 1); }
	for (const diagnostic of ts.getPreEmitDiagnostics(updated)) {
		if (diagnostic.category !== ts.DiagnosticCategory.Error) { continue; }
		if (ignoreUnused && [6133, 6192, 6196, 6198, 6199].includes(diagnostic.code)) { continue; }
		const key = signature(diagnostic);
		const count = existing.get(key) ?? 0;
		if (count) { existing.set(key, count - 1); } else { throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')); }
	}
}
