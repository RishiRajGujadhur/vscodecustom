/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import * as path from 'node:path';
import { Project } from './project';
import { Change } from './refactor';
import { moveModuleMembers } from './moduleMembers';

/** Registers project tools alongside the existing structural refactoring commands. */
export function registerProjectTools(_context: vscode.ExtensionContext, run: <T>(document: vscode.TextDocument, action: (project: Project) => T) => T, command: (id: string, action: (editor: vscode.TextEditor) => Promise<void>) => void, preview: (changes: readonly Change[]) => Promise<void>): void {
	command('structural.moveModuleMembers', async editor => {
		const document = editor.document;
		const targets = run(document, project => project.program.getSourceFiles().filter(file => path.resolve(file.fileName) !== document.uri.fsPath && !file.isDeclarationFile && !project.program.isSourceFileFromExternalLibrary(file)).map(file => ({ label: vscode.workspace.asRelativePath(file.fileName), fileName: file.fileName })));
		const target = await vscode.window.showQuickPick(targets, { placeHolder: vscode.l10n.t('Move Exports to an Existing Project File') });
		if (!target) { return; }
		let changes: readonly Change[];
		try { changes = run(document, project => moveModuleMembers(project, document.uri.fsPath, document.offsetAt(editor.selection.start), document.offsetAt(editor.selection.end), target.fileName)); }
		catch (error) {
			const messages: Record<string, string> = {
				moveTarget: vscode.l10n.t('Choose a Different Source File in This Compiler Project.'),
				moveSelection: vscode.l10n.t('Select Top-Level Exported Declarations or Place the Cursor Inside One.'),
				moveDirectives: vscode.l10n.t('Source and Destination Must Have Matching Module Directives.')
			};
			throw new Error(error instanceof Error ? messages[error.message] ?? error.message : String(error));
		}
		const review = vscode.l10n.t('Review Edits');
		if (await vscode.window.showWarningMessage(vscode.l10n.t('Review Module Initialization Order and Consumers Outside This Compiler Project.'), review) === review) { await preview(changes); }
	});
}

