/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import { Project, nodeAt, resolvedSymbol } from './project';
import { analyzeFunction, FunctionFlow, UnsupportedFlow } from './controlFlow';
import * as ts from 'typescript';

function escape(value: string): string { return value.replace(/[&<>"']/g, character => `&#${character.charCodeAt(0)};`); }
function variableAt(project: Project, file: string, offset: number, flow: FunctionFlow): string | undefined {
	const symbol = resolvedSymbol(project, nodeAt(project.program.getSourceFile(file)!, offset));
	return [...flow.variables.keys()].find(key => symbol?.declarations?.some(declaration => (ts.isVariableDeclaration(declaration) || ts.isParameter(declaration)) && declaration.name.getStart() === Number(key.slice(key.lastIndexOf('@') + 1))));
}

export function registerFunctionFlow(context: vscode.ExtensionContext, withProject: <T>(document: vscode.TextDocument, action: (project: Project) => T) => T, register: (id: string, action: (editor: vscode.TextEditor) => Promise<void>) => void): void {
	const analyze = (editor: vscode.TextEditor) => withProject(editor.document, project => {
		try {
			const offset = editor.document.offsetAt(editor.selection.active);
			const flow = analyzeFunction(project, editor.document.uri.fsPath, offset);
			return { flow, key: variableAt(project, editor.document.uri.fsPath, offset, flow), offset };
		} catch (error) { if (error instanceof UnsupportedFlow) { throw new Error(vscode.l10n.t('Flow Analysis Requires a Supported Function Body. Nested Functions, Destructuring, Try/Switch, for-in/of, and Embedded Writes Are Not Supported.')); } throw error; }
	});
	register('structural.functionFlow', async editor => {
		const { flow, key } = analyze(editor);
		const panel = vscode.window.createWebviewPanel('structural.functionFlow', vscode.l10n.t('Function Control and Value Flow'), vscode.ViewColumn.Beside, { enableScripts: true, localResourceRoots: [] });
		const nonce = randomBytes(18).toString('hex');
		const graph = flow.nodes.map(node => {
			const facts = flow.facts[node.id];
			const names = (keys: Iterable<string>) => [...keys].map(key => flow.variables.get(key) ?? key).join(', ');
			const origins = key ? [...facts.reaching.get(key) ?? []].map(id => id === -1 ? vscode.l10n.t('Unassigned') : id === 0 ? vscode.l10n.t('Parameter') : `#${id}`).join(', ') : '';
			const values = key ? [...facts.values.get(key) ?? []].join(', ') : '';
			return `<article class="${facts.reachable ? '' : 'unreachable'}"><button data-node="${node.id}">#${node.id} ${escape(node.label)}</button><p>${escape(vscode.l10n.t('Live In: {0}; Live Out: {1}', names(facts.liveIn), names(facts.liveOut)))}</p>${key ? `<p>${escape(vscode.l10n.t('{0}: Values [{1}]; Origins [{2}]', flow.variables.get(key)!, values, origins))}</p>` : ''}<p>${escape(vscode.l10n.t('May Be Unassigned: {0}', names(facts.possiblyUnassigned)))}</p><nav>${node.edges.map(edge => `<button data-node="${edge.target}">${edge.exceptional ? escape(vscode.l10n.t('Exception')) : edge.branch === undefined ? '→' : escape(edge.branch ? vscode.l10n.t('True') : vscode.l10n.t('False'))} #${edge.target}</button>`).join(' ')}</nav></article>`;
		}).join('');
		panel.webview.html = `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'"><style nonce="${nonce}">body{font-family:var(--vscode-font-family);color:var(--vscode-editor-foreground);background:var(--vscode-editor-background);padding:16px}article{border:1px solid var(--vscode-panel-border);padding:12px;margin:12px 0}button{color:var(--vscode-button-foreground);background:var(--vscode-button-background);border:0;padding:6px;cursor:pointer}p{overflow-wrap:anywhere}.unreachable{opacity:.55}button:focus{outline:2px solid var(--vscode-focusBorder)}</style></head><body><h1>${escape(vscode.l10n.t('Function Control and Value Flow'))}</h1><p>${escape(vscode.l10n.t('Static Snapshot. ? Means Unknown; Unreachable Nodes Are Dimmed. Click a Node to Navigate. Calls and Property Access May Throw.'))}</p>${graph}<h2>${escape(vscode.l10n.t('Known Property Mutations'))}</h2>${flow.mutations.map(mutation => `<p>${escape(mutation.text)}</p>`).join('')}<script nonce="${nonce}">const api=acquireVsCodeApi();document.addEventListener('click',event=>{const button=event.target.closest('button[data-node]');if(button)api.postMessage({node:Number(button.dataset.node)});});</script></body></html>`;
		const subscriptions: vscode.Disposable[] = [];
		subscriptions.push(panel.webview.onDidReceiveMessage(async (message: { node?: number }) => {
			const node = typeof message?.node === 'number' && Number.isInteger(message.node) ? flow.nodes[message.node] : undefined;
			if (!node) { return; }
			const document = await vscode.workspace.openTextDocument(editor.document.uri);
			await vscode.window.showTextDocument(document, { viewColumn: editor.viewColumn, selection: new vscode.Range(document.positionAt(node.start), document.positionAt(node.end)) });
		}));
		subscriptions.push(vscode.workspace.onDidChangeTextDocument(event => { if (event.document.uri.toString() === editor.document.uri.toString()) { panel.dispose(); } }));
		subscriptions.push(panel.onDidDispose(() => subscriptions.forEach(subscription => subscription.dispose())));
		context.subscriptions.push(panel);
	});
	register('structural.valueOrigins', async editor => {
		const { flow, key, offset } = analyze(editor);
		const use = flow.nodes.filter(node => node.start <= offset && offset < node.end && key && node.uses.includes(key)).sort((a, b) => a.end - a.start - (b.end - b.start))[0];
		if (!key || !use) { throw new Error(vscode.l10n.t('Select a Local Variable Use to Inspect Its Reaching Assignments.')); }
		const origins = [...flow.facts[use.id].reaching.get(key) ?? []];
		const picked = await vscode.window.showQuickPick(origins.map(id => ({ label: id === -1 ? vscode.l10n.t('Possibly Unassigned') : id === 0 ? vscode.l10n.t('Function Parameter') : flow.nodes[id].label, id })), { placeHolder: vscode.l10n.t('Assignments That May Reach This Use') });
		if (picked && picked.id > 0) { editor.selection = new vscode.Selection(editor.document.positionAt(flow.nodes[picked.id].start), editor.document.positionAt(flow.nodes[picked.id].end)); editor.revealRange(editor.selection); }
	});
}
