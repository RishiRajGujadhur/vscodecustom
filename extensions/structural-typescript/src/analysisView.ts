/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import * as ts from 'typescript';
import { AnalysisNode, flowTree, hierarchyRelations, symbolAt, typeTree, unusedDiagnostics } from './analysis';
import { Project } from './project';

export function registerAnalysis(context: vscode.ExtensionContext, run: <T>(document: vscode.TextDocument, action: (project: Project) => T) => T, command: (id: string, action: (editor: vscode.TextEditor) => Promise<void>) => void): void {
	const hierarchyItem = (symbol: ts.Symbol): vscode.TypeHierarchyItem[] => {
		const declaration = symbol.declarations?.find(node => ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node));
		if (!declaration) { return []; }
		const source = declaration.getSourceFile();
		const position = (offset: number) => { const point = source.getLineAndCharacterOfPosition(offset); return new vscode.Position(point.line, point.character); };
		const name = (declaration as ts.ClassDeclaration | ts.InterfaceDeclaration | ts.TypeAliasDeclaration).name;
		const selection = new vscode.Range(position(name?.getStart() ?? declaration.getStart()), position(name?.end ?? declaration.getStart()));
		return [new vscode.TypeHierarchyItem(ts.isClassDeclaration(declaration) ? vscode.SymbolKind.Class : vscode.SymbolKind.Interface, symbol.name, '', vscode.Uri.file(source.fileName), new vscode.Range(position(declaration.getStart()), position(declaration.end)), selection)];
	};
	const related = async (item: vscode.TypeHierarchyItem, reverse: boolean): Promise<vscode.TypeHierarchyItem[]> => {
		const document = await vscode.workspace.openTextDocument(item.uri);
		return run(document, project => {
			const symbol = symbolAt(project, document.uri.fsPath, document.offsetAt(item.selectionRange.start));
			return symbol ? hierarchyRelations(project, symbol, reverse).flatMap(hierarchyItem) : [];
		});
	};
	context.subscriptions.push(vscode.languages.registerTypeHierarchyProvider(['typescript', 'typescriptreact', 'javascript', 'javascriptreact'].map(language => ({ language, scheme: 'file' })), {
		prepareTypeHierarchy: (document, position) => run(document, project => {
			const symbol = symbolAt(project, document.uri.fsPath, document.offsetAt(position));
			return symbol ? hierarchyItem(symbol) : [];
		}),
		provideTypeHierarchySupertypes: item => related(item, false),
		provideTypeHierarchySubtypes: item => related(item, true)
	}));
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
			const message = item.code === 98001 ? vscode.l10n.t('No statically resolved reads of this internal interface field were found. Dynamic accesses may still use it.')
				: item.code === 98002 ? vscode.l10n.t('This typeof guard is constant according to the static type. Runtime values outside the declared type may differ.') : ts.flattenDiagnosticMessageText(item.messageText, '\n');
			const diagnostic = new vscode.Diagnostic(new vscode.Range(start.line, start.character, end.line, end.character), message, vscode.DiagnosticSeverity.Hint);
			if (item.code < 98000) { diagnostic.tags = [vscode.DiagnosticTag.Unnecessary]; }
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
