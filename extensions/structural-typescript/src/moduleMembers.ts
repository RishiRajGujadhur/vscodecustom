/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as ts from 'typescript';
import { Project } from './project';
import { Change } from './refactor';
import { validateChanges } from './globalRefactor';

/** Moves complete exported declarations using TypeScript's import-aware refactoring. */
export function moveModuleMembers(project: Project, fileName: string, start: number, end: number, targetFile: string): readonly Change[] {
	const source = project.program.getSourceFile(fileName)!;
	const target = project.program.getSourceFile(targetFile);
	if (!target || target === source || target.isDeclarationFile || project.program.isSourceFileFromExternalLibrary(target)) { throw new Error('moveTarget'); }
	const statements = source.statements.filter(statement => start === end ? statement.getStart() <= start && start < statement.end : statement.end > start && statement.getStart() < end);
	if (!statements.length || statements.some(statement => !(ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement) || ts.isEnumDeclaration(statement) || ts.isVariableStatement(statement)) || !ts.canHaveModifiers(statement) || !ts.getModifiers(statement)?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword))) { throw new Error('moveSelection'); }
	// Moving across framework directives can change server/client execution semantics.
	const directives = (file: ts.SourceFile) => file.statements.filter(ts.isExpressionStatement).filter(statement => ts.isStringLiteral(statement.expression)).map(statement => statement.expression.getText()).join();
	if (directives(source) !== directives(target)) { throw new Error('moveDirectives'); }
	const result = project.service.getEditsForRefactor(fileName, { indentSize: 4, tabSize: 4, newLineCharacter: '\n', convertTabsToSpaces: false }, { pos: statements[0].getStart(), end: statements[statements.length - 1].end }, 'Move to file', 'Move to file', { allowTextChangesInNewFiles: true }, { targetFile });
	if (!result?.edits.length || result.notApplicableReason || result.edits.some(edit => edit.isNewFile)) { throw new Error('moveSelection'); }
	const changes = result.edits.flatMap(edit => edit.textChanges.map(change => ({ fileName: edit.fileName, start: change.span.start, length: change.span.length, text: change.newText, documentText: project.program.getSourceFile(edit.fileName)!.text })));
	// TypeScript can emit multiple insertions at one offset. Preserve their original order.
	for (let index = changes.length - 1; index > 0; index--) {
		const current = changes[index], previous = changes[index - 1];
		if (current.fileName === previous.fileName && current.start === previous.start && !current.length && !previous.length) {
			previous.text += current.text;
			changes.splice(index, 1);
		}
	}
	validateChanges(project, changes);
	return changes;
}
