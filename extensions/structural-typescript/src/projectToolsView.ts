/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import * as path from 'node:path';
import { Project } from './project';
import { Change } from './refactor';
import { moveModuleMembers } from './moduleMembers';
import { findDeadCode } from './deadCode';

/** Registers project tools alongside the existing structural refactoring commands. */
export function registerProjectTools(context: vscode.ExtensionContext, run: <T>(document: vscode.TextDocument, action: (project: Project) => T) => T, command: (id: string, action: (editor: vscode.TextEditor) => Promise<void>) => void, preview: (changes: readonly Change[]) => Promise<void>): void {
	const diagnostics = vscode.languages.createDiagnosticCollection('structural-project-tools');
	context.subscriptions.push(diagnostics);
	let generation = 0;
	const clear = () => { generation++; diagnostics.clear(); };
	context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(clear), vscode.workspace.onDidCreateFiles(clear), vscode.workspace.onDidDeleteFiles(clear), vscode.workspace.onDidRenameFiles(clear));
	command('structural.findDeadCode', async editor => {
		const document = editor.document;
		const files = run(document, project => project.program.getSourceFiles().filter(file => !file.isDeclarationFile && !project.program.isSourceFileFromExternalLibrary(file)).map(file => ({ label: vscode.workspace.asRelativePath(file.fileName), fileName: file.fileName, picked: path.resolve(file.fileName) === document.uri.fsPath })));
		const entries = await vscode.window.showQuickPick(files, { canPickMany: true, placeHolder: vscode.l10n.t('Select All Application Entry Files (Their Exports Are Public API)') });
		if (!entries?.length) { return; }
		const analyzedGeneration = generation;
		const findings = run(document, project => findDeadCode(project, entries.map(entry => entry.fileName)));
		diagnostics.clear();
		const byFile = new Map<string, vscode.Diagnostic[]>();
		for (const finding of findings) {
			const source = await vscode.workspace.openTextDocument(vscode.Uri.file(finding.fileName));
			const labels = {
				file: vscode.l10n.t('File Is Unreachable from Selected Entry Files: {0}. Check Dynamic Loading and Framework Conventions.', finding.name),
				export: vscode.l10n.t('Possibly Unused Export: {0}. No Reachable Static Uses Were Found.', finding.name),
				component: vscode.l10n.t('Possibly Unused Component: {0}. No Reachable Static Uses Were Found.', finding.name),
				function: vscode.l10n.t('Possibly Unused Function or Class: {0}. No Reachable Static Uses Were Found.', finding.name)
			};
			const diagnostic = new vscode.Diagnostic(new vscode.Range(source.positionAt(finding.start), source.positionAt(finding.start + finding.length)), labels[finding.kind], vscode.DiagnosticSeverity.Information);
			diagnostic.source = vscode.l10n.t('Find Dead Code');
			diagnostic.code = finding.kind;
			const list = byFile.get(finding.fileName) ?? []; list.push(diagnostic); byFile.set(finding.fileName, list);
		}
		if (generation !== analyzedGeneration) { return; }
		for (const [file, list] of byFile) { diagnostics.set(vscode.Uri.file(file), list); }
		if (!findings.length) { vscode.window.showInformationMessage(vscode.l10n.t('No Dead Code Candidates Found for the Selected Entry Files.')); }
		await vscode.commands.executeCommand('workbench.actions.view.problems');
	});
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

