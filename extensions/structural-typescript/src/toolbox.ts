/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';

/** A single searchable entry point for the structural commands, using native quick input. */
export function registerToolbox(context: vscode.ExtensionContext, clearAnalysis: () => void): void {
	context.subscriptions.push(vscode.commands.registerCommand('structural.clearAnalysisResults', clearAnalysis));
	context.subscriptions.push(vscode.commands.registerCommand('structural.openTools', async () => {
		const selected = await vscode.window.showQuickPick([
			{ label: vscode.l10n.t('Analyze'), kind: vscode.QuickPickItemKind.Separator },
			{ label: vscode.l10n.t('Find Dead Code'), detail: vscode.l10n.t('Review unused exports, functions, components and files.'), command: 'structural.findDeadCode' },
			{ label: vscode.l10n.t('Advanced Nullability Analysis'), detail: vscode.l10n.t('Trace unsafe null and undefined values in Problems.'), command: 'structural.advancedNullability' },
			{ label: vscode.l10n.t('Test Impact Analysis'), detail: vscode.l10n.t('Find tests linked to a symbol, module or Git changes.'), command: 'structural.testImpact' },
			{ label: vscode.l10n.t('Function Data Flow'), detail: vscode.l10n.t('Inspect reaching values, branches, liveness and mutations.'), command: 'structural.functionFlow' },
			{ label: vscode.l10n.t('Go to Reaching Value Origins'), detail: vscode.l10n.t('Jump from a local variable use to its possible assignments.'), command: 'structural.valueOrigins' },
			{ label: vscode.l10n.t('Refactor'), kind: vscode.QuickPickItemKind.Separator },
			{ label: vscode.l10n.t('Move Module Members'), detail: vscode.l10n.t('Move exports to an existing file and update imports.'), command: 'structural.moveModuleMembers' },
			{ label: vscode.l10n.t('Change Signature'), detail: vscode.l10n.t('Edit parameters and migrate supported callers.'), command: 'structural.changeSignature' },
			{ label: vscode.l10n.t('Safe Delete Symbol'), detail: vscode.l10n.t('Review references and initialization effects before deletion.'), command: 'structural.safeDelete' },
			{ label: vscode.l10n.t('Safe Delete File'), detail: vscode.l10n.t('Review module consumers before deleting the active file.'), command: 'structural.safeDeleteFile' },
			{ label: vscode.l10n.t('Advanced Intention Actions'), detail: vscode.l10n.t('Open refactoring suggestions at the cursor. Also available with Ctrl+.'), command: 'structural.showIntentions' },
			{ label: vscode.l10n.t('Results'), kind: vscode.QuickPickItemKind.Separator },
			{ label: vscode.l10n.t('Clear Analysis Results'), detail: vscode.l10n.t('Clear structural diagnostics and dependency trees.'), command: 'structural.clearAnalysisResults' }
		], { title: vscode.l10n.t('Structural Tools'), placeHolder: vscode.l10n.t('Search by Tool Name or What You Want to Do'), matchOnDetail: true });
		if (!selected?.command) { return; }
		if (selected.command !== 'structural.clearAnalysisResults') {
			const document = vscode.window.activeTextEditor?.document;
			if (!document || document.uri.scheme !== 'file' || !/^(typescript|typescriptreact|javascript|javascriptreact)$/.test(document.languageId)) {
				vscode.window.showInformationMessage(vscode.l10n.t('Open a TypeScript or JavaScript Source File to Use This Tool.')); return;
			}
		}
		await vscode.commands.executeCommand(selected.command);
	}));
	context.subscriptions.push(vscode.commands.registerCommand('structural.showIntentions', () => vscode.commands.executeCommand('editor.action.codeAction', { kind: 'refactor.rewrite', apply: 'never' })));
}
