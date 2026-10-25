/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { Project } from './project';
import { analyzeTestImpact, ImpactTarget } from './testImpact';
import { projectSnapshot, sameSnapshot } from './snapshot';

interface GitChange { readonly uri: vscode.Uri; readonly originalUri: vscode.Uri; readonly renameUri: vscode.Uri | undefined }
interface ImpactRepository {
	readonly state: { readonly indexChanges: readonly GitChange[]; readonly workingTreeChanges: readonly GitChange[]; readonly untrackedChanges: readonly GitChange[]; readonly mergeChanges: readonly GitChange[] };
	status(): Promise<void>;
}
interface ImpactGitExtension { getAPI(version: 1): { getRepository(uri: vscode.Uri): ImpactRepository | null } }

/** Offers affected tests with reference/dependency evidence and source navigation. */
export function registerTestImpact(command: (id: string, action: (editor: vscode.TextEditor) => Promise<void>) => void, run: <T>(document: vscode.TextDocument, action: (project: Project) => T) => T): void {
	command('structural.testImpact', async editor => {
		const document = editor.document;
		const offset = document.offsetAt(editor.selection.active);
		const version = document.version;
		const scope = await vscode.window.showQuickPick([
			{ label: vscode.l10n.t('Function or Symbol at Cursor'), scope: 'symbol' },
			{ label: vscode.l10n.t('Active Module'), scope: 'module' },
			{ label: vscode.l10n.t('Git-Changed Modules'), scope: 'git' }
		], { placeHolder: vscode.l10n.t('Test Impact Analysis Scope') });
		if (!scope) { return; }
		let targets: ImpactTarget[] = [{ fileName: document.uri.fsPath, offset: scope.scope === 'symbol' ? offset : undefined }];
		if (scope.scope === 'git') {
			const extension = vscode.extensions.getExtension<ImpactGitExtension>('vscode.git');
			if (!extension) { throw new Error(vscode.l10n.t('Enable the Built-In Git Extension to Analyze Git Changes.')); }
			const api = await extension.activate();
			const repository = api.getAPI(1).getRepository(document.uri);
			if (!repository) { throw new Error(vscode.l10n.t('The Active File Must Belong to an Open Git Repository.')); }
			await repository.status();
			const state = repository.state;
			const names = new Set([...state.indexChanges, ...state.workingTreeChanges, ...state.untrackedChanges, ...state.mergeChanges].flatMap(change => [change.uri.fsPath, change.originalUri.fsPath, ...(change.renameUri ? [change.renameUri.fsPath] : [])]));
			for (const buffer of vscode.workspace.textDocuments) { if (buffer.isDirty && buffer.uri.scheme === 'file' && api.getAPI(1).getRepository(buffer.uri) === repository) { names.add(buffer.uri.fsPath); } }
			targets = [...names].filter(name => /\.[cm]?[jt]sx?$/.test(name)).map(fileName => ({ fileName }));
			if (!targets.length) { vscode.window.showInformationMessage(vscode.l10n.t('No Changed TypeScript or JavaScript Modules Found.')); return; }
		}
		if (document.version !== version) { throw new Error(vscode.l10n.t('The Source Changed. Run Test Impact Analysis Again.')); }
		const { result, snapshot } = run(document, project => ({ result: analyzeTestImpact(project, targets), snapshot: projectSnapshot(project) }));
		if (result.excludedFiles.length) { vscode.window.showWarningMessage(vscode.l10n.t('{0} Changed Files Are Outside the Active Compiler Project or No Longer Exist. Their Impact Was Not Analyzed.', result.excludedFiles.length)); }
		if (!result.tests.length) { vscode.window.showInformationMessage(vscode.l10n.t('No Statically Linked Tests Found in This Compiler Project. Dynamic and External Tests May Still Be Affected.')); return; }
		const test = await vscode.window.showQuickPick(result.tests.map(test => ({
			label: test.name,
			description: vscode.workspace.asRelativePath(test.fileName),
			detail: test.chain.map(step => step.name).join(' → '), test
		})), { placeHolder: vscode.l10n.t('{0} Potentially Affected Tests — Select One to Open', result.tests.length), matchOnDescription: true, matchOnDetail: true });
		if (!test) { return; }
		if (!run(document, project => sameSnapshot(project, snapshot))) { throw new Error(vscode.l10n.t('The Project Changed. Run Test Impact Analysis Again.')); }
		const source = await vscode.workspace.openTextDocument(vscode.Uri.file(test.test.fileName));
		const position = source.positionAt(test.test.start);
		await vscode.window.showTextDocument(source, { selection: new vscode.Range(position, position) });
	});
}
