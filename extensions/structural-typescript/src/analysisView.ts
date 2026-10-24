/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import * as ts from 'typescript';
import { AnalysisNode, flowTree, symbolAt, typeTree, unusedDiagnostics } from './analysis';
import { Project } from './project';

export function registerAnalysis(context: vscode.ExtensionContext, run: <T>(document: vscode.TextDocument, action: (project: Project) => T) => T, command: (id: string, action: (editor: vscode.TextEditor) => Promise<void>) => void): void {
	const changes = new vscode.EventEmitter<void>();
	context.subscriptions.push(changes);
	let roots: AnalysisNode[] = [];
	const provider: vscode.TreeDataProvider<AnalysisNode> = {
		onDidChangeTreeData: changes.event,
		getChildren: element => element ? element.children : roots,
		getTreeItem: element => {
			const item = new vscode.TreeItem(element.label, element.children.length ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
			item.description = vscode.workspace.asRelativePath(element.fileName);
			item.iconPath = new vscode.ThemeIcon('symbol-interface');
			item.command = { command: 'structural.openAnalysisNode', title: vscode.l10n.t('Open Declaration'), arguments: [element] };
			return item;
		}
	};
	context.subscriptions.push(vscode.window.registerTreeDataProvider('structural.analysis', provider));
	context.subscriptions.push(vscode.commands.registerCommand('structural.openAnalysisNode', async (element: AnalysisNode) => {
		const document = await vscode.workspace.openTextDocument(vscode.Uri.file(element.fileName));
		await vscode.window.showTextDocument(document, { selection: new vscode.Range(document.positionAt(element.start), document.positionAt(element.start)) });
	}));
	for (const [id, flow, reverse] of [
		['structural.typeDependencies', false, false], ['structural.typeDependents', false, true],
		['structural.flowFrom', true, false], ['structural.flowTo', true, true]
	] as const) {
		command(id, async editor => {
			const tree = run(editor.document, project => {
				const symbol = symbolAt(project, editor.document.uri.fsPath, editor.document.offsetAt(editor.selection.active));
				if (!symbol) { throw new Error(vscode.l10n.t('Select a Symbol to Analyze.')); }
				return flow ? flowTree(project, symbol, reverse) : typeTree(project, symbol, reverse);
			});
			roots = tree ? [tree] : [];
			changes.fire();
			await vscode.commands.executeCommand('structural.analysis.focus');
		});
	}
	const diagnostics = vscode.languages.createDiagnosticCollection('structural-unused');
	context.subscriptions.push(diagnostics);
	command('structural.unused', async editor => {
		const result = run(editor.document, unusedDiagnostics);
		diagnostics.clear();
		const byFile = new Map<string, vscode.Diagnostic[]>();
		for (const item of result) {
			if (!item.file || item.start === undefined) { continue; }
			const start = item.file.getLineAndCharacterOfPosition(item.start);
			const end = item.file.getLineAndCharacterOfPosition(item.start + (item.length ?? 0));
			const diagnostic = new vscode.Diagnostic(new vscode.Range(start.line, start.character, end.line, end.character), ts.flattenDiagnosticMessageText(item.messageText, '\n'), vscode.DiagnosticSeverity.Hint);
			diagnostic.tags = [vscode.DiagnosticTag.Unnecessary];
			diagnostic.source = vscode.l10n.t('Project Unused Analysis');
			const entries = byFile.get(item.file.fileName) ?? [];
			entries.push(diagnostic);
			byFile.set(item.file.fileName, entries);
		}
		for (const [file, entries] of byFile) { diagnostics.set(vscode.Uri.file(file), entries); }
		await vscode.commands.executeCommand('workbench.actions.view.problems');
	});
	// Results are snapshots; invalidate rather than leave stale ranges after edits.
	context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(() => { diagnostics.clear(); roots = []; changes.fire(); }));
}
