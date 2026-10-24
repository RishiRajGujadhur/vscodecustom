/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import * as ts from 'typescript';
import { Project } from './project';
import { Change, extractComponent, rename } from './refactor';
import { registerStructure } from './structureView';
import { moveMember, parameterObject, validateChanges } from './globalRefactor';
import { registerAnalysis } from './analysisView';

export function withProject<T>(document: vscode.TextDocument, action: (project: Project) => T): T {
	const project = new Project(document.uri.fsPath, new Map(vscode.workspace.textDocuments.filter(doc => doc.uri.scheme === 'file').map(doc => [doc.uri.fsPath, doc.getText()])));
	try { return action(project); } finally { project.dispose(); }
}

async function workspaceEdit(changes: readonly Change[]): Promise<vscode.WorkspaceEdit> {
	const edit = new vscode.WorkspaceEdit();
	for (const change of changes) {
		const uri = vscode.Uri.file(change.fileName);
		const document = await vscode.workspace.openTextDocument(uri);
		edit.replace(uri, new vscode.Range(document.positionAt(change.start), document.positionAt(change.start + change.length)), change.text, { needsConfirmation: true, label: vscode.l10n.t('Review Structural Refactoring') });
	}
	return edit;
}

export function registerCommand(context: vscode.ExtensionContext, id: string, action: (editor: vscode.TextEditor) => Promise<void>): void {
	context.subscriptions.push(vscode.commands.registerCommand(id, async () => {
		const editor = vscode.window.activeTextEditor;
		if (!editor || !['typescript', 'typescriptreact', 'javascript', 'javascriptreact'].includes(editor.document.languageId) || editor.document.uri.scheme !== 'file') { return; }
		try { await action(editor); } catch (error) { vscode.window.showErrorMessage(vscode.l10n.t('TypeScript Structure: {0}', error instanceof Error ? error.message : String(error))); }
	}));
}

export async function preview(changes: readonly Change[]): Promise<void> {
	const edit = await workspaceEdit(changes);
	await vscode.workspace.applyEdit(edit, { isRefactoring: true });
}

export function activate(context: vscode.ExtensionContext): void {
	registerStructure(context);
	registerAnalysis(context, withProject, (id, action) => registerCommand(context, id, action));
	for (const [id, operation] of [
		['structural.parameterObject', (project: Project, file: string, offset: number) => parameterObject(project, file, offset)],
		['structural.pullMemberUp', (project: Project, file: string, offset: number) => moveMember(project, file, offset, 'up')],
		['structural.pushMemberDown', (project: Project, file: string, offset: number) => moveMember(project, file, offset, 'down')]
	] as const) {
		registerCommand(context, id, async editor => {
			const changes = withProject(editor.document, project => {
				const edits = operation(project, editor.document.uri.fsPath, editor.document.offsetAt(editor.selection.active));
				validateChanges(project, edits);
				return edits;
			});
			await preview(changes);
		});
	}
	registerCommand(context, 'structural.safeRename', async editor => {
		const name = await vscode.window.showInputBox({ prompt: vscode.l10n.t('New Symbol Name') });
		if (!name) { return; }
		const mode = await vscode.window.showQuickPick([
			{ label: vscode.l10n.t('Symbol References'), text: false },
			{ label: vscode.l10n.t('Symbol, String and Comment References'), text: true }
		], { placeHolder: vscode.l10n.t('Text Matches May Refer to Unrelated Symbols. Review the Preview.') });
		if (!mode) { return; }
		const changes = withProject(editor.document, project => rename(project, editor.document.uri.fsPath, editor.document.offsetAt(editor.selection.active), name, mode.text));
		await preview(changes);
	});
	registerCommand(context, 'structural.extractComponent', async editor => {
		const name = await vscode.window.showInputBox({ prompt: vscode.l10n.t('New Component Name') });
		if (!name) { return; }
		const result = withProject(editor.document, project => extractComponent(project, editor.document.uri.fsPath, editor.document.offsetAt(editor.selection.start), editor.document.offsetAt(editor.selection.end), name));
		const uri = vscode.Uri.file(result.fileName);
		try { await vscode.workspace.fs.stat(uri); throw new Error(vscode.l10n.t('The Component File Already Exists.')); }
		catch (error) { if (!(error instanceof vscode.FileSystemError && error.code === 'FileNotFound')) { throw error; } }
		// Validate the generated module in the original project before offering the edit.
		withProject(editor.document, project => {
			const source = project.program.getSourceFile(editor.document.uri.fsPath)!;
			const host = ts.createCompilerHost(project.program.getCompilerOptions());
			const read = host.readFile;
			host.readFile = file => file === result.fileName ? result.content : file === source.fileName ? source.text : read(file);
			host.fileExists = file => file === result.fileName || ts.sys.fileExists(file);
			const check = ts.createProgram([...project.program.getRootFileNames(), result.fileName], project.program.getCompilerOptions(), host);
			const generated = check.getSourceFile(result.fileName)!;
			const errors = [...check.getSyntacticDiagnostics(generated), ...check.getSemanticDiagnostics(generated)].filter(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error && diagnostic.code !== 6133 && diagnostic.code !== 6192);
			if (errors.length) { throw new Error(ts.flattenDiagnosticMessageText(errors[0].messageText, '\n')); }
		});
		const edit = await workspaceEdit(result.changes);
		edit.createFile(uri, { overwrite: false }, { needsConfirmation: true, label: vscode.l10n.t('Create Component') });
		edit.insert(uri, new vscode.Position(0, 0), result.content);
		await vscode.workspace.applyEdit(edit, { isRefactoring: true });
	});
}
