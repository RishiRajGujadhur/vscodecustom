/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { Project } from './project';
import { safeDelete, safeDeleteFile, DeleteRisk } from './safeDelete';
import { Change } from './refactor';
import { projectSnapshot, sameSnapshot, snapshotText } from './snapshot';
import { documentOffset } from './documentEdits';

const riskText: Record<DeleteRisk, () => string> = {
	external: () => vscode.l10n.t('External Consumers or Entry Points Cannot Be Ruled Out.'),
	dynamic: () => vscode.l10n.t('Dynamic Access, Reflection, or Matching Strings Make Usage Uncertain.'),
	sideEffects: () => vscode.l10n.t('Removing This Declaration Could Remove Initialization Effects.'),
	unsupported: () => vscode.l10n.t('This Declaration or Its Combined Edits Are Not Supported.')
};
function escaped(text: string): string { return text.replace(/[\\`*_{}\[\]<>#]/g, character => `\\${character}`); }
export function registerSafeDelete(withProject: <T>(document: vscode.TextDocument, action: (project: Project) => T) => T, register: (id: string, action: (editor: vscode.TextEditor) => Promise<void>) => void, preview: (changes: readonly Change[], files?: readonly { fileName: string; documentText: string }[]) => Promise<void>): void {
	for (const file of [false, true]) {
		register(file ? 'structural.safeDeleteFile' : 'structural.safeDelete', async editor => {
			const { plan, snapshot } = withProject(editor.document, project => ({ plan: file ? safeDeleteFile(project, editor.document.uri.fsPath) : safeDelete(project, editor.document.uri.fsPath, editor.document.offsetAt(editor.selection.active)), snapshot: projectSnapshot(project) }));
			const blocking = plan.usages.filter(usage => usage.kind === 'blocking');
			const removable = plan.usages.filter(usage => usage.kind === 'removable');
			const lines = [`# ${vscode.l10n.t('Safe Delete Review')}`, '', `## ${escaped(plan.name)}`, '', escaped(vscode.l10n.t('{0} Blocking References · {1} Removable Imports · {2} Risks', blocking.length, removable.length, plan.risks.length)), '', ...plan.risks.map(risk => `- ${escaped(riskText[risk]())}`), ''];
			for (const usages of [blocking, removable]) {
				if (!usages.length) { continue; }
				lines.push(`### ${usages === blocking ? vscode.l10n.t('Blocking References') : vscode.l10n.t('Removable Imports')}`, '');
				for (const usage of usages) {
					const document = await vscode.workspace.openTextDocument(vscode.Uri.file(usage.fileName));
					const original = snapshotText(snapshot, usage.fileName);
					const offset = original === undefined ? undefined : documentOffset(original, document.getText(), usage.start);
					if (offset === undefined) { throw new Error(vscode.l10n.t('The Project Changed During Review. Run Safe Delete Again.')); }
					const position = document.positionAt(offset);
					lines.push(`- [${escaped(vscode.workspace.asRelativePath(document.uri))}:${position.line + 1}](${document.uri.toString()}#L${position.line + 1},${position.character + 1}) — ${escaped(document.lineAt(position.line).text.trim())}`);
				}
				lines.push('');
			}
			if (!plan.usages.length) { lines.push(vscode.l10n.t('No Known References in This Compiler Project. This Is Not Proof That External Consumers Do Not Exist.')); }
			await vscode.window.showTextDocument(await vscode.workspace.openTextDocument({ language: 'markdown', content: lines.join('\n') }), { viewColumn: vscode.ViewColumn.Beside, preview: true });
			if (plan.usages.some(usage => usage.kind === 'blocking') || plan.risks.some(risk => risk === 'sideEffects' || risk === 'unsupported')) {
				vscode.window.showWarningMessage(vscode.l10n.t('Deletion Is Blocked. Review the References or Unsupported Initialization Effects.'));
				return;
			}
			const review = vscode.l10n.t('Review Deletion Edits');
			const answer = await vscode.window.showWarningMessage(plan.risks.length ? vscode.l10n.t('Deletion Is Uncertain. Review the Risk Report and the Complete Change Before Proceeding.') : vscode.l10n.t('Review the Target Deletion and Unused Import Edits.'), { modal: true }, review);
			if (answer === review) {
				if (!withProject(editor.document, project => sameSnapshot(project, snapshot))) { throw new Error(vscode.l10n.t('The Project Changed During Review. Run Safe Delete Again.')); }
				await preview(plan.changes, plan.files);
			}
		});
	}
}
