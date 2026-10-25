/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import * as path from 'node:path';
import { Project } from './project';
import { Change } from './refactor';
import { moveModuleMembers } from './moduleMembers';
import { findDeadCode } from './deadCode';
import { analyzeNullability } from './nullability';
import { registerTestImpact } from './testImpactView';
import { projectSnapshot, sameSnapshot, snapshotText } from './snapshot';
import { documentOffset } from './documentEdits';
import { canonicalFileName } from './projectGraph';


function analysisRange(document: vscode.TextDocument, snapshot: ReadonlyMap<string, string>, start: number, length: number): vscode.Range | undefined {
	const original = snapshotText(snapshot, document.uri.fsPath);
	if (original === undefined) { return undefined; }
	const text = document.getText();
	const first = documentOffset(original, text, start), last = documentOffset(original, text, start + length);
	return first === undefined || last === undefined ? undefined : new vscode.Range(document.positionAt(first), document.positionAt(last));
}

/** Registers project tools alongside the existing structural refactoring commands. */
export function registerProjectTools(context: vscode.ExtensionContext, run: <T>(document: vscode.TextDocument, action: (project: Project) => T) => T, command: (id: string, action: (editor: vscode.TextEditor) => Promise<void>) => void, preview: (changes: readonly Change[]) => Promise<void>): () => void {
	registerTestImpact(context, command, run);
	const diagnostics = vscode.languages.createDiagnosticCollection('structural-project-tools');
	const nullDiagnostics = vscode.languages.createDiagnosticCollection('structural-nullability');
	context.subscriptions.push(diagnostics, nullDiagnostics);
	let generation = 0, nullRun = 0, deadRun = 0;
	let latestReport: string | undefined;
	const report = (title: string, byFile: ReadonlyMap<string, readonly vscode.Diagnostic[]>) => {
		const lines = [title, ''];
		for (const [file, findings] of byFile) {
			for (const finding of findings) {
				lines.push(`${vscode.workspace.asRelativePath(file)}:${finding.range.start.line + 1}:${finding.range.start.character + 1} — ${finding.message}`);
				for (const related of finding.relatedInformation ?? []) {
					lines.push(`  ${vscode.workspace.asRelativePath(related.location.uri)}:${related.location.range.start.line + 1}:${related.location.range.start.character + 1} — ${related.message}`);
				}
			}
		}
		return lines.length > 2 ? lines.join('\n') : title + '\n\n' + vscode.l10n.t('No Findings.');
	};
	context.subscriptions.push(vscode.commands.registerCommand('structural.copyAnalysisReport', async () => {
		if (latestReport === undefined) { vscode.window.showInformationMessage(vscode.l10n.t('Run Find Dead Code or Advanced Nullability Analysis First.')); return; }
		try {
			await vscode.env.clipboard.writeText(latestReport);
			vscode.window.showInformationMessage(vscode.l10n.t('Copied Analysis Report.'));
		} catch (error) { vscode.window.showErrorMessage(vscode.l10n.t('Could Not Copy Results: {0}', error instanceof Error ? error.message : String(error))); }
	}));
	const clear = () => { generation++; latestReport = undefined; diagnostics.clear(); nullDiagnostics.clear(); };
	context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(clear), vscode.workspace.onDidCreateFiles(clear), vscode.workspace.onDidDeleteFiles(clear), vscode.workspace.onDidRenameFiles(clear));
	command('structural.advancedNullability', async editor => {
		const request = ++nullRun;
		const analyzedGeneration = generation;
		const buffers = new Map(vscode.workspace.textDocuments.filter(document => document.uri.scheme === 'file').map(document => [document.uri.fsPath, document.getText()]));
		const project = new Project(editor.document.uri.fsPath, buffers, { strictNullChecks: true, strictPropertyInitialization: false, noUncheckedIndexedAccess: true, allowJs: true, checkJs: true });
		let findings: ReturnType<typeof analyzeNullability>;
		let snapshot: ReadonlyMap<string, string>;
		try { findings = analyzeNullability(project); snapshot = projectSnapshot(project); } finally { project.dispose(); }
		const byFile = new Map<string, vscode.Diagnostic[]>();
		for (const finding of findings) {
			const document = await vscode.workspace.openTextDocument(vscode.Uri.file(finding.fileName));
			const range = analysisRange(document, snapshot, finding.start, finding.length);
			if (!range) { clear(); return; }
			const diagnostic = new vscode.Diagnostic(range, finding.message, vscode.DiagnosticSeverity.Warning);
			diagnostic.source = vscode.l10n.t('Advanced Nullability Analysis');
			diagnostic.code = finding.code;
			diagnostic.relatedInformation = [];
			for (const location of finding.trace) {
				const source = await vscode.workspace.openTextDocument(vscode.Uri.file(location.fileName));
				const range = analysisRange(source, snapshot, location.start, location.length);
				if (!range) { clear(); return; }
				const labels = { source: vscode.l10n.t('Possible Value Source: {0}', location.text), branch: vscode.l10n.t('Path Condition: {0}', location.text), return: vscode.l10n.t('Possible Return Value: {0}', location.text) };
				diagnostic.relatedInformation.push(new vscode.DiagnosticRelatedInformation(new vscode.Location(source.uri, range), labels[location.kind]));
			}
			const list = byFile.get(finding.fileName) ?? []; list.push(diagnostic); byFile.set(finding.fileName, list);
		}
		if (generation !== analyzedGeneration || request !== nullRun) { return; }
		nullDiagnostics.clear();
		latestReport = report(vscode.l10n.t('Advanced Nullability Analysis'), byFile);
		for (const [file, list] of byFile) { nullDiagnostics.set(vscode.Uri.file(file), list); }
		if (!findings.length) { vscode.window.showInformationMessage(vscode.l10n.t('No Nullability Hazards Found in This Compiler Project.')); }
		await vscode.commands.executeCommand('workbench.actions.view.problems');
	});
	command('structural.findDeadCode', async editor => {
		const request = ++deadRun;
		const document = editor.document;
		const projectKey = run(document, project => canonicalFileName(project.directory));
		const saved = context.workspaceState.get<readonly string[]>('structural.deadCode.entries.' + projectKey);
		const files = run(document, project => project.program.getSourceFiles().filter(file => !file.isDeclarationFile && !project.program.isSourceFileFromExternalLibrary(file)).map(file => ({ label: vscode.workspace.asRelativePath(file.fileName), fileName: file.fileName, picked: saved ? saved.includes(canonicalFileName(file.fileName)) : path.resolve(file.fileName) === document.uri.fsPath })));
		if (!files.some(file => file.picked)) { const active = files.find(file => path.resolve(file.fileName) === document.uri.fsPath); if (active) { active.picked = true; } }
		const entries = await vscode.window.showQuickPick(files, { canPickMany: true, title: vscode.l10n.t('Find Dead Code — Entry Files'), placeHolder: vscode.l10n.t('Select All Entry Files. Your Selection Is Remembered for This Project.'), matchOnDescription: true });
		if (!entries?.length) { return; }
		const analyzedGeneration = generation;
		const { findings, snapshot } = run(document, project => {
			try { return { findings: findDeadCode(project, entries.map(entry => entry.fileName)), snapshot: projectSnapshot(project) }; }
			catch (error) { if (error instanceof Error && error.message === 'deadCodeEntry') { throw new Error(vscode.l10n.t('An Entry File Left the Compiler Project. Run Find Dead Code Again.')); } throw error; }
		});
		await context.workspaceState.update('structural.deadCode.entries.' + projectKey, entries.map(entry => canonicalFileName(entry.fileName)));
		const byFile = new Map<string, vscode.Diagnostic[]>();
		for (const finding of findings) {
			const source = await vscode.workspace.openTextDocument(vscode.Uri.file(finding.fileName));
			const labels = {
				file: vscode.l10n.t('File Is Unreachable from Selected Entry Files: {0}. Check Dynamic Loading and Framework Conventions.', finding.name),
				export: vscode.l10n.t('Possibly Unused Export: {0}. No Reachable Static Uses Were Found.', finding.name),
				component: vscode.l10n.t('Possibly Unused Component: {0}. No Reachable Static Uses Were Found.', finding.name),
				function: vscode.l10n.t('Possibly Unused Function or Class: {0}. No Reachable Static Uses Were Found.', finding.name)
			};
			const range = analysisRange(source, snapshot, finding.start, finding.length);
			if (!range) { clear(); return; }
			const diagnostic = new vscode.Diagnostic(range, labels[finding.kind], vscode.DiagnosticSeverity.Information);
			diagnostic.source = vscode.l10n.t('Find Dead Code');
			diagnostic.code = finding.kind;
			const list = byFile.get(finding.fileName) ?? []; list.push(diagnostic); byFile.set(finding.fileName, list);
		}
		if (generation !== analyzedGeneration || request !== deadRun) { return; }
		diagnostics.clear();
		latestReport = report(vscode.l10n.t('Find Dead Code'), byFile);
		for (const [file, list] of byFile) { diagnostics.set(vscode.Uri.file(file), list); }
		if (!findings.length) { vscode.window.showInformationMessage(vscode.l10n.t('No Dead Code Candidates Found for the Selected Entry Files.')); }
		await vscode.commands.executeCommand('workbench.actions.view.problems');
	});
	command('structural.moveModuleMembers', async editor => {
		const document = editor.document;
		const targets = run(document, project => project.program.getSourceFiles().filter(file => path.resolve(file.fileName) !== document.uri.fsPath && !file.isDeclarationFile && !project.program.isSourceFileFromExternalLibrary(file)).map(file => ({ label: vscode.workspace.asRelativePath(file.fileName), fileName: file.fileName })));
		const previous = context.workspaceState.get<string>('structural.moveModuleMembers.destination.' + canonicalFileName(path.dirname(document.uri.fsPath)));
		const ranked = targets.map(target => ({ ...target, description: canonicalFileName(target.fileName) === previous ? vscode.l10n.t('Last Destination') : undefined })).sort((a, b) => Number(!!b.description) - Number(!!a.description) || a.label.localeCompare(b.label));
		const target = await vscode.window.showQuickPick(ranked, { title: vscode.l10n.t('Move Module Members'), placeHolder: vscode.l10n.t('Move Exports to an Existing Project File'), matchOnDescription: true });
		if (!target) { return; }
		let changes: readonly Change[];
		let snapshot: ReadonlyMap<string, string>;
		try {
			({ changes, snapshot } = run(document, project => ({
				changes: moveModuleMembers(project, document.uri.fsPath, document.offsetAt(editor.selection.start), document.offsetAt(editor.selection.end), target.fileName),
				snapshot: projectSnapshot(project)
			})));
		}
		catch (error) {
			const messages: Record<string, string> = {
				moveTarget: vscode.l10n.t('Choose a Different Source File in This Compiler Project.'),
				moveSelection: vscode.l10n.t('Select Top-Level Exported Declarations or Place the Cursor Inside One.'),
				moveDirectives: vscode.l10n.t('Source and Destination Must Have Matching Module Directives.')
			};
			throw new Error(error instanceof Error ? messages[error.message] ?? error.message : String(error));
		}
		await context.workspaceState.update('structural.moveModuleMembers.destination.' + canonicalFileName(path.dirname(document.uri.fsPath)), canonicalFileName(target.fileName));
		const review = vscode.l10n.t('Review Edits');
		if (await vscode.window.showWarningMessage(vscode.l10n.t('Review Module Initialization Order and Consumers Outside This Compiler Project.'), review) === review) {
			if (!run(document, project => sameSnapshot(project, snapshot))) { throw new Error(vscode.l10n.t('The Project Changed. Run Move Module Members Again.')); }
			await preview(changes);
		}
	});
	return clear;
}

