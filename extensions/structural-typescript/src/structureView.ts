/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import * as ts from 'typescript';
import { structure, StructureNode } from './structure';

function symbols(document: vscode.TextDocument): vscode.DocumentSymbol[] {
	const source = ts.createSourceFile(document.fileName, document.getText(), ts.ScriptTarget.Latest, true, document.languageId === 'typescriptreact' ? ts.ScriptKind.TSX : ts.ScriptKind.JSX);
	const convert = (node: StructureNode): vscode.DocumentSymbol => {
		const range = new vscode.Range(document.positionAt(node.start), document.positionAt(node.end));
		const kind = node.kind === 'component' ? vscode.SymbolKind.Object : node.kind === 'hook' ? vscode.SymbolKind.Event : node.kind === 'declaration' ? vscode.SymbolKind.Function : vscode.SymbolKind.Operator;
		const item = new vscode.DocumentSymbol(node.label, '', kind, range, new vscode.Range(range.start, range.start));
		item.children = node.children.map(convert);
		return item;
	};
	return structure(source).map(convert);
}

export function registerStructure(context: vscode.ExtensionContext): void {
	const changes = new vscode.EventEmitter<void>();
	context.subscriptions.push(changes);
	context.subscriptions.push(vscode.languages.registerDocumentSymbolProvider([{ language: 'typescriptreact', scheme: 'file' }, { language: 'javascriptreact', scheme: 'file' }], { provideDocumentSymbols: symbols }, { label: vscode.l10n.t('React Structure') }));
	const provider: vscode.TreeDataProvider<vscode.DocumentSymbol> = {
		onDidChangeTreeData: changes.event,
		getChildren: element => {
			if (element) { return element.children; }
			const document = vscode.window.activeTextEditor?.document;
			return document && ['typescriptreact', 'javascriptreact'].includes(document.languageId) ? symbols(document) : [];
		},
		getTreeItem: element => {
			const item = new vscode.TreeItem(element.name, element.children.length ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None);
			const uri = vscode.window.activeTextEditor?.document.uri;
			item.command = { command: 'vscode.open', title: vscode.l10n.t('Go to Element'), arguments: [uri, { selection: element.selectionRange }] };
			item.iconPath = new vscode.ThemeIcon(element.kind === vscode.SymbolKind.Object ? 'symbol-object' : element.kind === vscode.SymbolKind.Event ? 'symbol-event' : 'symbol-method');
			return item;
		}
	};
	context.subscriptions.push(vscode.window.registerTreeDataProvider('structural.reactStructure', provider));
	let pending: ReturnType<typeof setTimeout> | undefined;
	context.subscriptions.push({ dispose: () => clearTimeout(pending) });
	context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(() => changes.fire()));
	context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(event => {
		if (event.document === vscode.window.activeTextEditor?.document) {
			clearTimeout(pending);
			pending = setTimeout(() => changes.fire(), 250);
		}
	}));
}
