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
	const directives = (file: ts.SourceFile): string => {
		const values: string[] = [];
		for (const statement of file.statements) {
			if (!ts.isExpressionStatement(statement) || !ts.isStringLiteral(statement.expression)) { break; }
			values.push(statement.expression.text);
		}
		return JSON.stringify(values);
	};
	if (directives(source) !== directives(target)) { throw new Error('moveDirectives'); }
	const result = project.service.getEditsForRefactor(fileName, { indentSize: 4, tabSize: 4, newLineCharacter: '\n', convertTabsToSpaces: false }, { pos: statements[0].getStart(), end: statements[statements.length - 1].end }, 'Move to file', 'Move to file', { allowTextChangesInNewFiles: true }, { targetFile });
	if (!result?.edits.length || result.notApplicableReason || result.edits.some(edit => edit.isNewFile)) { throw new Error('moveSelection'); }
	const changes: Change[] = [];
	for (const edit of result.edits) {
		const byStart = new Map<number, Change>();
		for (const change of edit.textChanges) {
			const previous = byStart.get(change.span.start);
			if (previous) {
				if (previous.length && change.span.length) { throw new Error('moveSelection'); }
				byStart.set(change.span.start, { ...previous, length: Math.max(previous.length, change.span.length), text: previous.text + change.newText });
			} else { byStart.set(change.span.start, { fileName: edit.fileName, start: change.span.start, length: change.span.length, text: change.newText, documentText: project.program.getSourceFile(edit.fileName)!.text }); }
		}
		changes.push(...byStart.values());
	}
	validateChanges(project, changes);
	return changes;
}
