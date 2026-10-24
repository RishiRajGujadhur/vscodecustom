/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as ts from 'typescript';
import * as path from 'node:path';
import { isReference, Project, walk } from './project';
import { RefactorError } from './errors';

export interface Change { readonly fileName: string; readonly start: number; readonly length: number; readonly text: string; readonly documentText?: string }
export interface Extraction { readonly fileName: string; readonly content: string; readonly changes: readonly Change[] }

export function extractComponent(project: Project, fileName: string, start: number, end: number, name: string): Extraction {
	if (!/^[A-Z][$\w]*$/.test(name)) { throw new RefactorError('invalidComponentName'); }
	const source = project.program.getSourceFile(fileName)!;
	let selected: ts.JsxElement | ts.JsxSelfClosingElement | ts.JsxFragment | undefined;
	walk(source, node => {
		if ((ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node))
			&& source.text.slice(start, node.getStart()).trim() === '' && source.text.slice(node.end, end).trim() === ''
			&& start <= node.getStart() && node.end <= end) { selected = node; }
	});
	if (!selected) { throw new RefactorError('invalidSelection'); }
	const jsx = selected as ts.JsxElement | ts.JsxSelfClosingElement | ts.JsxFragment;
	const props = new Map<string, string>();
	const imports: string[] = [];
	for (const statement of source.statements) {
		if (ts.isImportDeclaration(statement) || ts.isImportEqualsDeclaration(statement)) { imports.push(statement.getText(source)); }
	}
	walk(jsx, node => {
		if (node.kind === ts.SyntaxKind.ThisKeyword || node.kind === ts.SyntaxKind.SuperKeyword
			|| ts.isAwaitExpression(node) || ts.isYieldExpression(node)
			|| ts.isPostfixUnaryExpression(node) || ts.isPrefixUnaryExpression(node) && (node.operator === ts.SyntaxKind.PlusPlusToken || node.operator === ts.SyntaxKind.MinusMinusToken)
			|| ts.isBinaryExpression(node) && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
			|| ts.isCallExpression(node) && /(?:^|\.)use(?:[A-Z]|$)/.test(node.expression.getText(source))) {
			throw new RefactorError('unsafeSelection');
		}
		if (!ts.isIdentifier(node) || !isReference(node)) { return; }
		const symbol = ts.isShorthandPropertyAssignment(node.parent) ? project.checker.getShorthandAssignmentValueSymbol(node.parent) : project.checker.getSymbolAtLocation(node);
		const declarations = symbol?.declarations ?? [];
		if (!declarations.length || declarations.every(decl => decl.getSourceFile() !== source || decl.getStart() >= jsx.getStart() && decl.end <= jsx.end)) { return; }
		if (declarations.some(decl => ts.isImportSpecifier(decl) || ts.isImportClause(decl) || ts.isNamespaceImport(decl) || ts.isImportEqualsDeclaration(decl))) { return; }
		const type = project.checker.typeToString(project.checker.getTypeAtLocation(node), node, ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.UseFullyQualifiedType)
			.replace(/import\("(?<specifier>[^"]+)"\)/g, (match: string, specifier: string) => {
				if (!path.isAbsolute(specifier)) { return match; }
				const normalized = specifier.replace(/\\/g, '/');
				const dependency = normalized.lastIndexOf('/node_modules/');
				let relative = dependency >= 0 ? normalized.slice(dependency + '/node_modules/'.length).replace(/\/index$/, '') : path.relative(path.dirname(fileName), specifier).replace(/\\/g, '/');
				if (relative.startsWith('@types/')) { relative = relative.slice('@types/'.length).replace(/^(?<scope>[^/]+)__(?<name>[^/]+)/, '@$<scope>/$<name>'); }
				if (dependency < 0 && !relative.startsWith('.')) { relative = `./${relative}`; }
				return `import("${relative}")`;
			});
		props.set(node.text, type);
	});
	const typed = /\.tsx$/i.test(fileName);
	if (props.has('key') || props.has('ref')) { throw new RefactorError('reservedProp'); }
	const rootElement = ts.isJsxElement(jsx) ? jsx.openingElement : ts.isJsxSelfClosingElement(jsx) ? jsx : undefined;
	if (rootElement?.attributes.properties.some(property => ts.isJsxSpreadAttribute(property) || ts.isJsxAttribute(property) && property.name.getText(source) === 'key')) {
		throw new RefactorError('rootKey');
	}
	const target = path.join(path.dirname(fileName), name + (typed ? '.tsx' : '.jsx'));
	const directive = source.statements.filter(ts.isExpressionStatement).filter(statement => ts.isStringLiteral(statement.expression) && statement.expression.text === 'use client').map(statement => statement.getText()).join('\n');
	const fields = [...props].map(([key, type]) => `\t${key}: ${type};`).join('\n');
	const jsdoc = `/** @param {{ ${[...props].map(([key, type]) => `${key}: ${type}`).join(', ')} }} props */\n`;
	const content = `${directive ? directive + '\n' : ''}${imports.join('\n')}\n\n${typed ? `interface ${name}Props {\n${fields}\n}\n\n` : jsdoc}export function ${name}({ ${[...props.keys()].join(', ')} }${typed ? `: ${name}Props` : ''}) {\n\treturn (${jsx.getText(source)});\n}\n`;
	const insertion = source.statements.find(statement => !ts.isImportDeclaration(statement) && !(ts.isExpressionStatement(statement) && ts.isStringLiteral(statement.expression)))?.getStart() ?? source.end;
	return { fileName: target, content, changes: [
		{ fileName, start: jsx.getStart(), length: jsx.getWidth(), text: `<${name}${[...props.keys()].map(key => ` ${key}={${key}}`).join('')} />` },
		{ fileName, start: insertion, length: 0, text: `import { ${name} } from './${name}';\n` }
	] };
}

export function rename(project: Project, fileName: string, offset: number, name: string, textReferences: boolean): readonly Change[] {
	if (!/^[$A-Z_a-z][$\w]*$/.test(name)) { throw new RefactorError('invalidIdentifier'); }
	const info = project.service.getRenameInfo(fileName, offset, { allowRenameOfImportPath: false });
	if (!info.canRename) { throw new Error(info.localizedErrorMessage); }
	const locations = project.service.findRenameLocations(fileName, offset, textReferences, textReferences, true);
	return (locations ?? []).filter(location => !project.program.getSourceFile(location.fileName)?.isDeclarationFile).map(location => ({
		fileName: location.fileName, start: location.textSpan.start, length: location.textSpan.length,
		text: `${location.prefixText ?? ''}${name}${location.suffixText ?? ''}`
	}));
}

export function textReferenceChanges(fileName: string, text: string, oldName: string, newName: string): readonly Change[] {
	if (!oldName) { throw new RefactorError('invalidIdentifier'); }
	const escaped = oldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const pattern = new RegExp(`(?<![\\w$])${escaped}(?![\\w$])`, 'g');
	return [...text.matchAll(pattern)].map(match => ({ fileName, start: match.index, length: oldName.length, text: newName, documentText: text }));
}
