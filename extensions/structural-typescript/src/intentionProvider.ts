/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { Project } from './project';
import { Change } from './refactor';
import { intentionsAt } from './intentions';

const titles: Readonly<Record<string, () => string>> = {
	ifToTernary: () => vscode.l10n.t('Convert Return Branches to a Ternary'),
	ternaryToIf: () => vscode.l10n.t('Convert Returned Ternary to Branches'),
	loopToMap: () => vscode.l10n.t('Convert Array Accumulation to Map'),
	promiseToAwait: () => vscode.l10n.t('Convert Promise Fulfillment to Await'),
	functionToArrow: () => vscode.l10n.t('Convert Local Function Expression to Arrow'),
	extractRepeated: () => vscode.l10n.t('Extract Repeated Pure Expression'),
	simplifyBoolean: () => vscode.l10n.t('Simplify Boolean Comparison'),
	nullGuard: () => vscode.l10n.t('Guard Nullable Receiver'),
	guardClause: () => vscode.l10n.t('Convert Return Branches to Guard Clause'),
	stringTemplate: () => vscode.l10n.t('Convert String Concatenation to Template'),
	preferConst: () => vscode.l10n.t('Use Const for Unchanged Binding'),
	objectMethod: () => vscode.l10n.t('Convert Local Object Function to Method'),
	optionalAccess: () => vscode.l10n.t('Simplify Nullable Return with Optional Access')
};

export function registerIntentions(context: vscode.ExtensionContext, withProject: <T>(document: vscode.TextDocument, action: (project: Project) => T) => T, preview: (changes: readonly Change[]) => Promise<void>): void {
	context.subscriptions.push(vscode.commands.registerCommand('structural.applyIntention', async (uri: vscode.Uri, version: number, offset: number, id: string) => {
		try {
			const document = await vscode.workspace.openTextDocument(uri);
			if (document.version !== version) { throw new Error(vscode.l10n.t('The Source Changed. Request the Intention Again.')); }
			const changes = withProject(document, project => {
				const intention = intentionsAt(project, uri.fsPath, offset).find(candidate => candidate.rule.id === id);
				if (!intention) { throw new Error(vscode.l10n.t('This Intention Is No Longer Applicable.')); }
				const edits = intention.rule.getEdits(intention.context)!;
				intention.rule.validate(intention.context, edits);
				return edits;
			});
			await preview(changes);
		} catch (error) { vscode.window.showErrorMessage(vscode.l10n.t('TypeScript Structure: {0}', error instanceof Error ? error.message : String(error))); }
	}));
	context.subscriptions.push(vscode.languages.registerCodeActionsProvider(['typescript', 'typescriptreact', 'javascript', 'javascriptreact'].map(language => ({ language, scheme: 'file' })), {
		provideCodeActions(document, range, _context, token) {
			if (token.isCancellationRequested || !vscode.workspace.isTrusted) { return []; }
			try {
				return withProject(document, project => intentionsAt(project, document.uri.fsPath, document.offsetAt(range.start)).map(intention => {
					const action = new vscode.CodeAction(titles[intention.rule.id](), vscode.CodeActionKind.RefactorRewrite);
					action.command = { command: 'structural.applyIntention', title: action.title, arguments: [document.uri, document.version, document.offsetAt(range.start), intention.rule.id] };
					return action;
				}));
			} catch { return []; }
		}
	}, { providedCodeActionKinds: [vscode.CodeActionKind.RefactorRewrite] }));
}
