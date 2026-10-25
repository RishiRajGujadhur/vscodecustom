/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { Project } from './project';
import { analyzeTestImpact, ImpactTarget, ImpactedTest } from './testImpact';
import { projectSnapshot, sameSnapshot, snapshotText } from './snapshot';
import { documentOffset } from './documentEdits';
import { matchingImpactTests, impactFilePaths } from './testImpactResults';

interface GitChange { readonly uri: vscode.Uri; readonly originalUri: vscode.Uri; readonly renameUri: vscode.Uri | undefined }
interface ImpactRepository {
	readonly state: { readonly indexChanges: readonly GitChange[]; readonly workingTreeChanges: readonly GitChange[]; readonly untrackedChanges: readonly GitChange[]; readonly mergeChanges: readonly GitChange[] };
	status(): Promise<void>;
}
interface ImpactGitExtension { getAPI(version: 1): { getRepository(uri: vscode.Uri): ImpactRepository | null } }


async function pickImpactedTest(tests: readonly ImpactedTest[], validate: () => void): Promise<ImpactedTest | undefined> {
	const picker = vscode.window.createQuickPick<vscode.QuickPickItem & { test: ImpactedTest }>();
	const subscriptions: vscode.Disposable[] = [picker];
	const copyPaths: vscode.QuickInputButton = { iconPath: new vscode.ThemeIcon('files'), tooltip: vscode.l10n.t('Copy Matching Test File Paths') };
	const copyReport: vscode.QuickInputButton = { iconPath: new vscode.ThemeIcon('copy'), tooltip: vscode.l10n.t('Copy Matching Impact Report') };
	const clearSearch: vscode.QuickInputButton = { iconPath: new vscode.ThemeIcon('clear-all'), tooltip: vscode.l10n.t('Clear Search') };
	const displayPath = (fileName: string) => vscode.workspace.asRelativePath(fileName);
	let matches: readonly ImpactedTest[] = tests;
	picker.placeholder = vscode.l10n.t('Search Tests, Files or Dependency Chains. All Search Words Must Match.');
	const update = (query: string) => {
		matches = matchingImpactTests(tests, query, displayPath);
		picker.title = vscode.l10n.t('Test Impact Analysis — {0} of {1} Results', matches.length, tests.length);
		picker.buttons = query ? [copyPaths, copyReport, clearSearch] : [copyPaths, copyReport];
		picker.items = matches.map(test => ({ label: test.kind === 'file' ? vscode.l10n.t('Test File: {0}', test.name) : test.name, description: displayPath(test.fileName), detail: test.chain.map(step => step.name).join(' → '), alwaysShow: true, test }));
	};
	update('');
	let disposed = false;
	try {
		return await new Promise<ImpactedTest | undefined>(resolve => {
			subscriptions.push(picker.onDidAccept(() => resolve(picker.selectedItems[0]?.test)));
			subscriptions.push(picker.onDidHide(() => resolve(undefined)));
			subscriptions.push(picker.onDidChangeValue(update));
			subscriptions.push(picker.onDidTriggerButton(async button => {
				try {
					if (button === clearSearch) { picker.value = ''; return; }
					if (!matches.length) { picker.title = vscode.l10n.t('No Matching Results to Copy. Clear or Change Your Search.'); return; }
					validate();
					const paths = impactFilePaths(matches, displayPath);
					const text = button === copyPaths ? paths.join('\n') : matches.map(test => [test.name, vscode.workspace.asRelativePath(test.fileName), test.chain.map(step => step.name).join(' → ')].join('\n')).join('\n\n');
					await vscode.env.clipboard.writeText(text);
					if (!disposed) { picker.title = button === copyPaths ? vscode.l10n.t('Copied {0} Affected Test File Paths', paths.length) : vscode.l10n.t('Copied Test Impact Report'); }
				} catch (error) { vscode.window.showErrorMessage(vscode.l10n.t('Could Not Copy Results: {0}', error instanceof Error ? error.message : String(error))); }
			}));
			picker.show();
		});
	} finally { disposed = true; for (const subscription of subscriptions) { subscription.dispose(); } }
}

/** Offers affected tests with reference/dependency evidence and source navigation. */
export function registerTestImpact(context: vscode.ExtensionContext, command: (id: string, action: (editor: vscode.TextEditor) => Promise<void>) => void, run: <T>(document: vscode.TextDocument, action: (project: Project) => T) => T): void {
	command('structural.testImpact', async editor => {
		const document = editor.document;
		const offset = document.offsetAt(editor.selection.active);
		const version = document.version;
		const savedScope = context.workspaceState.get<string>('structural.testImpact.scope');
		const scopes = [
			{ label: vscode.l10n.t('Function or Symbol at Cursor'), detail: vscode.l10n.t('Follow callers and helpers to specific test registrations.'), scope: 'symbol' },
			{ label: vscode.l10n.t('Active Module'), detail: vscode.l10n.t('Include tests in modules that depend on this file.'), scope: 'module' },
			{ label: vscode.l10n.t('Git-Changed Modules'), detail: vscode.l10n.t('Include staged, unstaged, untracked and unsaved module changes.'), scope: 'git' }
		];
		const scope = await vscode.window.showQuickPick(scopes.map(item => ({ ...item, description: item.scope === savedScope ? vscode.l10n.t('Last Scope') : undefined })).sort((a, b) => Number(!!b.description) - Number(!!a.description)), { placeHolder: vscode.l10n.t('Test Impact Analysis Scope'), matchOnDetail: true });
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
		await context.workspaceState.update('structural.testImpact.scope', scope.scope);
		if (result.excludedFiles.length) { vscode.window.showWarningMessage(vscode.l10n.t('{0} Changed Files Are Outside the Active Compiler Project or No Longer Exist. Their Impact Was Not Analyzed.', result.excludedFiles.length)); }
		if (!result.tests.length) { vscode.window.showInformationMessage(vscode.l10n.t('No Statically Linked Tests Found in This Compiler Project. Dynamic and External Tests May Still Be Affected.')); return; }
		const test = await pickImpactedTest(result.tests, () => {
			if (!run(document, project => sameSnapshot(project, snapshot))) { throw new Error(vscode.l10n.t('The Project Changed. Run Test Impact Analysis Again.')); }
		});
		if (!test) { return; }
		if (!run(document, project => sameSnapshot(project, snapshot))) { throw new Error(vscode.l10n.t('The Project Changed. Run Test Impact Analysis Again.')); }
		const source = await vscode.workspace.openTextDocument(vscode.Uri.file(test.fileName));
		const original = snapshotText(snapshot, test.fileName);
		const mappedOffset = original === undefined ? undefined : documentOffset(original, source.getText(), test.start);
		if (mappedOffset === undefined) { throw new Error(vscode.l10n.t('The Source Changed. Run Test Impact Analysis Again.')); }
		const position = source.positionAt(mappedOffset);
		await vscode.window.showTextDocument(source, { selection: new vscode.Range(position, position) });
	});
}
