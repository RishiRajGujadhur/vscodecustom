/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import * as vscode from 'vscode';

export async function run(): Promise<void> {
	const extension = vscode.extensions.getExtension('vscode.structural-typescript');
	assert.ok(extension);
	const sourceRoot = process.env.STRUCTURAL_SOURCE_EXTENSION_PATH!;
	const normalized = (value: string) => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
	assert.equal(normalized(extension.extensionPath), normalized(process.env.STRUCTURAL_EXTENSION_DEV_PATH ?? sourceRoot));
	await extension.activate();
	const commands = await vscode.commands.getCommands();
	for (const command of ['structural.applyIntention', 'structural.functionFlow', 'structural.valueOrigins', 'structural.safeDelete', 'structural.safeDeleteFile', 'structural.changeSignature']) { assert.ok(commands.includes(command), command); }
	assert.ok(vscode.workspace.workspaceFolders?.length);
	const uri = vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri, 'sample.ts');
	const document = await vscode.workspace.openTextDocument(uri);
	const original = document.getText();
	const select = async (text: string) => {
		const editor = await vscode.window.showTextDocument(document, vscode.ViewColumn.One);
		const position = document.positionAt(original.indexOf(text));
		editor.selection = new vscode.Selection(position, position);
		return position;
	};
	const position = await select('flag===');
	assert.equal(document.languageId, 'typescript');
	assert.equal(vscode.workspace.isTrusted, true);
	const { Project } = require(path.join(sourceRoot, 'out/project.js')) as typeof import('../out/project.js');
	const project = new Project(uri.fsPath, new Map([[uri.fsPath, original]]));
	try { assert.ok((require(path.join(sourceRoot, 'out/intentions.js')) as typeof import('../out/intentions.js')).intentionsAt(project, uri.fsPath, document.offsetAt(position)).some(action => action.rule.id === 'simplifyBoolean')); } finally { project.dispose(); }
	let actions: vscode.CodeAction[] = [];
	for (let attempt = 0; attempt < 20; attempt++) {
		actions = await vscode.commands.executeCommand<vscode.CodeAction[]>('vscode.executeCodeActionProvider', uri, new vscode.Range(position, position), 'refactor.rewrite');
		if (actions.some(action => action.command?.command === 'structural.applyIntention')) { break; }
		await new Promise(resolve => setTimeout(resolve, 100));
	}
	assert.ok(actions.some(action => action.command?.command === 'structural.applyIntention' && action.command.arguments?.[3] === 'simplifyBoolean'), JSON.stringify(actions));
	await select('discount=0');
	await vscode.commands.executeCommand('structural.functionFlow');
	const flowVisible = () => vscode.window.tabGroups.all.some(group => group.tabs.some(tab => tab.input instanceof vscode.TabInputWebview && tab.input.viewType.includes('structural.functionFlow')));
	for (let attempt = 0; attempt < 40 && !flowVisible(); attempt++) { await new Promise(resolve => setTimeout(resolve, 100)); }
	assert.ok(flowVisible(), JSON.stringify(vscode.window.tabGroups.all.map(group => group.tabs.map(tab => ({ label: tab.label, input: tab.input })))));
	await select('used(){');
	await vscode.commands.executeCommand('structural.safeDelete');
	assert.ok(vscode.window.activeTextEditor?.document.getText().includes('Blocking'));
	assert.equal(document.getText(), original);
	await select('greet(');
	const editing = vscode.commands.executeCommand('structural.changeSignature');
	await new Promise(resolve => setTimeout(resolve, 700));
	await vscode.commands.executeCommand('workbench.action.closeQuickOpen');
	await editing;
	assert.equal(document.getText(), original);
	assert.equal(document.isDirty, false);
	console.log('Integration passed: command registration, compiler-backed lightbulb, flow webview, blocked Safe Delete and cancelled Change Signature.');
}
