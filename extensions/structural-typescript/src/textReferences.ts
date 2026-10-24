/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { Change, textReferenceChanges } from './refactor';

/** Explicitly opt-in text matches outside the compiler project, always presented for review. */
export async function workspaceTextReferences(oldName: string, newName: string, projectFiles: readonly string[]): Promise<readonly Change[]> {
	const normalize = (file: string) => file.replace(/\\/g, '/').toLowerCase();
	const semanticFiles = new Set(projectFiles.map(normalize));
	const files = await vscode.workspace.findFiles('**/*.{ts,tsx,js,jsx,mjs,cjs,css,scss,less,html,vue,svelte,json,jsonc,md,yaml,yml}', '**/{node_modules,.git,out,dist,coverage,.build}/**', 5001);
	if (files.length > 5000) { throw new Error(vscode.l10n.t('Workspace Text Search Exceeds 5,000 Files. Use Symbol References or a Smaller Workspace.')); }
	return vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: vscode.l10n.t('Finding Workspace Text References'), cancellable: true }, async (_progress, token) => {
		const changes: Change[] = [];
		for (const uri of files) {
			if (token.isCancellationRequested) { throw new vscode.CancellationError(); }
			if (uri.scheme !== 'file' || semanticFiles.has(normalize(uri.fsPath))) { continue; }
			const stat = await vscode.workspace.fs.stat(uri);
			if (stat.size > 2 * 1024 * 1024) { throw new Error(vscode.l10n.t('Text Search Cannot Safely Include the Large File: {0}', vscode.workspace.asRelativePath(uri))); }
			const document = await vscode.workspace.openTextDocument(uri);
			const text = document.getText();
			changes.push(...textReferenceChanges(uri.fsPath, text, oldName, newName));
		}
		return changes;
	});
}
