/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { documentChange, documentOffset } from './documentEdits';
import { registerProjectTools } from './projectToolsView';
import { Project } from './project';
import { Change, extractComponent, rename } from './refactor';
import { registerStructure } from './structureView';
import { inlineParameterObject, moveMember, parameterObject, validateChanges } from './globalRefactor';
import { registerAnalysis } from './analysisView';
import { workspaceTextReferences } from './textReferences';
import { RefactorError } from './errors';
import { errorMessage } from './errorMessages';
import { registerIntentions } from './intentionProvider';
import { registerFunctionFlow } from './functionFlowView';
import { registerSafeDelete } from './safeDeleteView';
import { registerChangeSignature } from './signatureEditor';

function captureChanges(project: Project, changes: readonly Change[]): readonly Change[] {
	return changes.map(change => ({ ...change, documentText: change.documentText ?? project.program.getSourceFile(change.fileName)?.text }));
}

export function withProject<T>(document: vscode.TextDocument, action: (project: Project) => T): T {
	const project = new Project(document.uri.fsPath, new Map(vscode.workspace.textDocuments.filter(doc => doc.uri.scheme === 'file').map(doc => [doc.uri.fsPath, doc.getText()])));
	try { return action(project); } finally { project.dispose(); }
}

async function workspaceEdit(changes: readonly Change[]): Promise<vscode.WorkspaceEdit> {
	const edit = new vscode.WorkspaceEdit();
	for (const change of changes) {
		const uri = vscode.Uri.file(change.fileName);
		const document = await vscode.workspace.openTextDocument(uri);
		const current = documentChange(change, document.getText());
		if (!current) { throw new Error(vscode.l10n.t('A Source File Changed During Analysis. Run the Refactoring Again.')); }
		edit.replace(uri, new vscode.Range(document.positionAt(current.start), document.positionAt(current.start + current.length)), current.text, { needsConfirmation: true, label: vscode.l10n.t('Review Structural Refactoring') });
	}
	return edit;
}

export function registerCommand(context: vscode.ExtensionContext, id: string, action: (editor: vscode.TextEditor) => Promise<void>): void {
	context.subscriptions.push(vscode.commands.registerCommand(id, async () => {
		const editor = vscode.window.activeTextEditor;
		if (!editor || !['typescript', 'typescriptreact', 'javascript', 'javascriptreact'].includes(editor.document.languageId) || editor.document.uri.scheme !== 'file') { return; }
		try { await action(editor); } catch (error) {
			if (!(error instanceof vscode.CancellationError)) { vscode.window.showErrorMessage(vscode.l10n.t('TypeScript Structure: {0}', error instanceof RefactorError ? errorMessage(error.code) : error instanceof Error ? error.message : String(error))); }
		}
	}));
}

export async function preview(changes: readonly Change[], files: readonly { fileName: string; documentText: string }[] = []): Promise<void> {
	const edit = await workspaceEdit(changes);
	for (const file of files) {
		const uri = vscode.Uri.file(file.fileName);
		const document = await vscode.workspace.openTextDocument(uri);
		if (documentOffset(file.documentText, document.getText(), file.documentText.length) === undefined) { throw new Error(vscode.l10n.t('A Source File Changed During Analysis. Run the Refactoring Again.')); }
		edit.deleteFile(uri, { recursive: false }, { needsConfirmation: true, label: vscode.l10n.t('Review File Deletion') });
	}
	await vscode.workspace.applyEdit(edit, { isRefactoring: true });
}

export function activate(context: vscode.ExtensionContext): void {
	registerProjectTools(context, withProject, (id, action) => registerCommand(context, id, action), preview);
	registerIntentions(context, withProject, preview);
	registerFunctionFlow(context, withProject, (id, action) => registerCommand(context, id, action));
	registerSafeDelete(withProject, (id, action) => registerCommand(context, id, action), preview);
	registerChangeSignature(withProject, (id, action) => registerCommand(context, id, action), preview);
	registerStructure(context);
	registerAnalysis(context, withProject, (id, action) => registerCommand(context, id, action));
	for (const [id, operation] of [
		['structural.parameterObject', (project: Project, file: string, offset: number) => parameterObject(project, file, offset)],
		['structural.inlineParameterObject', (project: Project, file: string, offset: number) => inlineParameterObject(project, file, offset)],
		['structural.pullMemberUp', (project: Project, file: string, offset: number) => moveMember(project, file, offset, 'up')],
		['structural.pushMemberDown', (project: Project, file: string, offset: number) => moveMember(project, file, offset, 'down')]
	] as const) {
		registerCommand(context, id, async editor => {
			const changes = withProject(editor.document, project => {
				const edits = operation(project, editor.document.uri.fsPath, editor.document.offsetAt(editor.selection.active));
				validateChanges(project, edits);
				return captureChanges(project, edits);
			});
			await preview(changes);
		});
	}
	registerCommand(context, 'structural.safeRename', async editor => {
		const name = await vscode.window.showInputBox({ prompt: vscode.l10n.t('New Symbol Name') });
		if (!name) { return; }
		const mode = await vscode.window.showQuickPick([
			{ label: vscode.l10n.t('Symbol References'), text: false, workspace: false },
			{ label: vscode.l10n.t('Symbol, String and Comment References'), text: true, workspace: false },
			{ label: vscode.l10n.t('Include Workspace Text Matches in Other File Types'), text: true, workspace: true }
		], { placeHolder: vscode.l10n.t('Text Matches May Refer to Unrelated Symbols. Review the Preview.') });
		if (!mode) { return; }
		const version = editor.document.version;
		const result = withProject(editor.document, project => {
			const edits = rename(project, editor.document.uri.fsPath, editor.document.offsetAt(editor.selection.active), name, mode.text);
			validateChanges(project, edits);
			const info = project.service.getRenameInfo(editor.document.uri.fsPath, editor.document.offsetAt(editor.selection.active));
			const source = project.program.getSourceFile(editor.document.uri.fsPath)!;
			const oldName = info.canRename ? source.text.slice(info.triggerSpan.start, info.triggerSpan.start + info.triggerSpan.length) : '';
			return { changes: captureChanges(project, edits), oldName, files: project.program.getSourceFiles().map(file => file.fileName) };
		});
		const textChanges = mode.workspace ? await workspaceTextReferences(result.oldName, name, result.files) : [];
		if (editor.document.version !== version) { throw new Error(vscode.l10n.t('A Source File Changed During Analysis. Run the Refactoring Again.')); }
		await preview([...result.changes, ...textChanges]);
	});
	registerCommand(context, 'structural.extractComponent', async editor => {
		const name = await vscode.window.showInputBox({ prompt: vscode.l10n.t('New Component Name') });
		if (!name) { return; }
		const result = withProject(editor.document, project => {
			const extraction = extractComponent(project, editor.document.uri.fsPath, editor.document.offsetAt(editor.selection.start), editor.document.offsetAt(editor.selection.end), name);
			return { ...extraction, changes: captureChanges(project, extraction.changes) };
		});
		const uri = vscode.Uri.file(result.fileName);
		try { await vscode.workspace.fs.stat(uri); throw new Error(vscode.l10n.t('The Component File Already Exists.')); }
		catch (error) { if (!(error instanceof vscode.FileSystemError && error.code === 'FileNotFound')) { throw error; } }
		withProject(editor.document, project => validateChanges(project, result.changes, new Map([[result.fileName, result.content]]), true));
		const edit = await workspaceEdit(result.changes);
		edit.createFile(uri, { overwrite: false }, { needsConfirmation: true, label: vscode.l10n.t('Create Component') });
		edit.insert(uri, new vscode.Position(0, 0), result.content);
		await vscode.workspace.applyEdit(edit, { isRefactoring: true });
	});
}
