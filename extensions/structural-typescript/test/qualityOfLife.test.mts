/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { createRequire } from 'node:module';
import type * as vscode from 'vscode';
import type { Project } from '../src/project.ts';
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { fixture } from './fixtures.mts';
import { currentSignature, changeSignature, validParameterName } from '../out/changeSignature.js';

test('signature input validates identifiers without rejecting contextual keywords', () => {
	assert.deepEqual(['value', '$value', '_count2', 'async', '', 'two words', '2count', 'class', 'a,b'].map(validParameterName), [true, true, true, true, false, false, false, false, false]);
});

test('displaying original signature types does not overwrite distinct overload types', () => {
	const code = 'export function f(input: string): string; export function f(input: number): number; export function f(input: string | number){return input;} f(1);';
	fixture({ 'a.ts': code }, (project, file) => {
		const signature = currentSignature(project, file, code.indexOf('f('));
		const parameters = signature.parameters.map(parameter => ({ ...parameter, name: 'value' }));
		const result = changeSignature(project, file, code.indexOf('f('), parameters);
		assert.deepEqual([signature.parameters[0].type, signature.parameters[0].originalType, result.changes.filter(change => change.text.startsWith('value:')).map(change => change.text).sort()], [undefined, 'string | number', ['value: number', 'value: string', 'value: string | number']]);
	});
});


test('test impact search matches all words across names, paths and dependency chains', async () => {
	const { matchingImpactTests, impactFilePaths } = await import('../out/testImpactResults.js');
	const tests = [
		{ name: 'formats directly', fileName: '/tests/format.test.ts', start: 0, chain: [{ name: 'formatLabel', fileName: '/src/format.ts', start: 0 }] },
		{ name: 'formats through adapter', fileName: '/tests/format.test.ts', start: 10, chain: [{ name: 'displayLabel', fileName: '/src/display.ts', start: 0 }] },
		{ name: 'renders view', fileName: '/tests/view.test.ts', start: 0, chain: [{ name: 'displayLabel', fileName: '/src/display.ts', start: 0 }] }
	];
	const displayPath = (file: string) => file.slice(1);
	assert.deepEqual(matchingImpactTests(tests, ' DISPLAYLABEL  FORMAT.TEST ', displayPath), [tests[1]]);
	assert.deepEqual(matchingImpactTests(tests, 'adapter formats', displayPath), [tests[1]]);
	assert.deepEqual(matchingImpactTests(tests, 'missing', displayPath), []);
	assert.equal(matchingImpactTests(tests, '  ', displayPath), tests);
	assert.deepEqual(impactFilePaths(tests, displayPath), ['tests/format.test.ts', 'tests/view.test.ts']);
	assert.deepEqual(impactFilePaths(matchingImpactTests(tests, 'view', displayPath), displayPath), ['tests/view.test.ts']);
});


test('signature preview failure retains the draft and undo/redo history', async () => {
	const realRequire = createRequire(new URL('../out/signatureEditor.js', import.meta.url));
	const signatures = realRequire('./changeSignature') as typeof import('../src/changeSignature.ts');
	const steps = ['remove', 'parameter', 'preview', 'undo', 'redo', 'undo', 'remove', 'parameter', 'undo', 'preview'];
	let errors = 0, previews = 0;
	const api = {
		l10n: { t: (text: string) => text },
		window: {
			showQuickPick: async (items: { id?: string; index?: number }[], options: { title?: string }) => {
				const step = steps.shift();
				if (step === 'parameter') { return items.find(item => item.index === 1); }
				if (steps.length === 5) { assert.ok(options.title?.includes('age')); }
				if (steps.length === 4) { assert.ok(!options.title?.includes('age')); }
				if (steps.length === 6) { assert.ok(!options.title?.includes('age')); }
				if (steps.length === 1) { assert.ok(!items.some(item => item.id === 'redo')); }
				assert.ok(items.some(item => item.id === step), 'action exists: ' + step);
				return items.find(item => item.id === step);
			},
			showErrorMessage: async (message: string, resume: string) => { errors++; assert.match(message, /Removed Parameter/); return resume; }
		}
	};
	const exported = {} as typeof import('../src/signatureEditor.ts');
	runInNewContext(readFileSync(new URL('../out/signatureEditor.js', import.meta.url), 'utf8'), {
		exports: exported,
		require: (id: string) => {
			if (id === 'vscode') { return api; }
			if (id === './snapshot') { return { projectSnapshot: () => new Map(), sameSnapshot: () => true }; }
			if (id === './changeSignature') { return {
				...signatures,
				currentSignature: () => ({ name: 'createUser', parameters: [{ name: 'name' }, { name: 'age' }] }),
				changeSignature: (_project: Project, _file: string, _offset: number, parameters: { name: string }[]) => {
					if (parameters.length !== 2) { throw new signatures.SignatureError('bodyReference'); }
					return { changes: [] };
				}
			}; }
			return realRequire(id);
		}
	});
	let action: ((editor: vscode.TextEditor) => Promise<void>) | undefined;
	exported.registerChangeSignature((_document, callback) => callback({} as Project), (_id, callback) => { action = callback; }, async () => { previews++; });
	await action!({ document: { uri: { fsPath: '/a.ts' }, offsetAt: () => 0 }, selection: { active: {} } } as unknown as vscode.TextEditor);
	assert.equal(steps.length, 0);
	assert.equal(errors, 1);
	assert.equal(previews, 1);
});


test('analysis reports copy locations and traces, replace the previous report and expire on edits', async () => {
	const realRequire = createRequire(new URL('../out/projectToolsView.js', import.meta.url));
	const registered = new Map<string, () => Promise<void>>();
	const copied: string[] = [], messages: string[] = [];
	let edited = () => {};
	let currentSnapshot = true, expectedText = 'export const unused = 1;', clears = 0, moves = 0;
	let beforeOpen = async () => {};
	let moving = false, onPick = () => {};
	const disposable = { dispose() {} };
	class Range {
		start; end;
		constructor(start: { line: number; character: number }, end: { line: number; character: number }) { this.start = start; this.end = end; }
	}
	class Diagnostic {
		range; message;
		constructor(range: Range, message: string) { this.range = range; this.message = message; }
	}
	const api = {
		l10n: { t: (text: string, value?: string) => text.replace('{0}', value ?? '') },
		Uri: { file: (file: string) => ({ fsPath: file }) }, Range, Diagnostic,
		DiagnosticSeverity: { Warning: 1, Information: 2 },
		Location: class { uri; range; constructor(uri: { fsPath: string }, range: Range) { this.uri = uri; this.range = range; } },
		DiagnosticRelatedInformation: class { location; message; constructor(location: object, message: string) { this.location = location; this.message = message; } },
		commands: { registerCommand: (id: string, action: () => Promise<void>) => { registered.set(id, action); return disposable; }, executeCommand: async () => {} },
		languages: { createDiagnosticCollection: () => ({ ...disposable, clear() { clears++; }, set() {} }) },
		env: { clipboard: { writeText: async (text: string) => { copied.push(text); } } },
		window: { showQuickPick: async () => { onPick(); return moving ? { fileName: '/project/b.ts' } : [{ fileName: '/project/a.ts' }]; }, showWarningMessage: async () => undefined, showInformationMessage: (text: string) => { messages.push(text); } },
		workspace: {
			textDocuments: [], asRelativePath: (file: string | { fsPath: string }) => (typeof file === 'string' ? file : file.fsPath).replace('/project/', ''),
			onDidChangeTextDocument: (callback: () => void) => { edited = callback; return disposable; },
			onDidCreateFiles: () => disposable, onDidDeleteFiles: () => disposable, onDidRenameFiles: () => disposable,
			openTextDocument: async () => { await beforeOpen(); return { uri: { fsPath: '/project/a.ts' }, getText: () => 'export const unused = 1;', positionAt: (offset: number) => ({ line: 0, character: offset }) }; }
		}
	};
	const project = { directory: '/project', program: { getSourceFiles: () => [{ fileName: '/project/a.ts' }], isSourceFileFromExternalLibrary: () => false } } as unknown as Project;
	const exported = {} as typeof import('../src/projectToolsView.ts');
	runInNewContext(readFileSync(new URL('../out/projectToolsView.js', import.meta.url), 'utf8'), {
		exports: exported,
		require: (id: string) => {
			if (id === 'vscode') { return api; }
			if (id === './testImpactView') { return { registerTestImpact() {} }; }
			if (id === './snapshot') { return { projectSnapshot: () => new Map(), snapshotText: () => expectedText, sameSnapshot: () => currentSnapshot }; }
			if (id === './moduleMembers') { return { moveModuleMembers: (_project: Project, _file: string, start: number, end: number) => { moves++; assert.equal(start, 13); assert.equal(end, 19); return []; } }; }
			if (id === './project') { return { Project: class { dispose() {} } }; }
			if (id === './deadCode') { return { findDeadCode: () => [{ fileName: '/project/a.ts', start: 13, length: 6, name: 'unused', kind: 'export' }] }; }
			if (id === './nullability') { return { analyzeNullability: () => [{ fileName: '/project/a.ts', start: 13, length: 6, message: 'Possibly undefined', code: 18048, trace: [{ fileName: '/project/a.ts', start: 0, length: 6, kind: 'source', text: 'maybe()' }] }] }; }
			return realRequire(id);
		}
	});
	const editorData = { document: { uri: { fsPath: '/project/a.ts' }, version: 1, offsetAt: (offset: number) => offset }, selection: { start: 13, end: 19 } };
	const editor = editorData as unknown as vscode.TextEditor;
	const clear = exported.registerProjectTools({ subscriptions: [], workspaceState: { get: () => undefined, update: async () => {} } } as unknown as vscode.ExtensionContext,
		(_document, callback) => callback(project), (id, action) => { registered.set(id, () => action(editor)); }, async () => {});
	await registered.get('structural.copyAnalysisReport')!();
	assert.equal(copied.length, 0);
	await registered.get('structural.findDeadCode')!();
	await registered.get('structural.copyAnalysisReport')!();
	assert.match(copied[0], /Find Dead Code\n\na.ts:1:14 — Possibly Unused Export: unused/);
	await registered.get('structural.advancedNullability')!();
	await registered.get('structural.copyAnalysisReport')!();
	assert.match(copied[1], /Advanced Nullability Analysis/);
	assert.match(copied[1], /a.ts:1:1 — Possible Value Source: maybe\(\)/);
	edited();
	await registered.get('structural.copyAnalysisReport')!();
	assert.equal(copied.length, 2);
	await registered.get('structural.findDeadCode')!(); clear();
	await registered.get('structural.copyAnalysisReport')!();
	assert.equal(copied.length, 2);
	assert.match(messages.at(-1)!, /Run Find Dead Code/);
	await registered.get('structural.findDeadCode')!();
	currentSnapshot = false;
	await registered.get('structural.copyAnalysisReport')!();
	assert.equal(copied.length, 2, 'external source changes must prevent copying');
	assert.match(messages.at(-1)!, /The Project Changed/);
	currentSnapshot = true;
	await registered.get('structural.copyAnalysisReport')!();
	assert.match(messages.at(-1)!, /Run Find Dead Code/, 'stale report was invalidated');
	let release!: () => void, opened!: () => void;
	const waiting = new Promise<void>(resolve => { opened = resolve; });
	const pending = new Promise<void>(resolve => { release = resolve; });
	beforeOpen = () => { beforeOpen = async () => {}; opened(); return pending; };
	const superseded = registered.get('structural.advancedNullability')!();
	await waiting;
	await registered.get('structural.advancedNullability')!();
	const publishedClears = clears;
	expectedText = 'changed'; release(); await superseded;
	assert.equal(clears, publishedClears, 'superseded results must not clear newer diagnostics');
	expectedText = 'export const unused = 1;';
	await registered.get('structural.copyAnalysisReport')!();
	assert.equal(copied.length, 3);
	assert.match(copied[2], /Advanced Nullability Analysis/);
	moving = true;
	onPick = () => { editorData.selection = { start: 40, end: 42 }; };
	await registered.get('structural.moveModuleMembers')!();
	assert.equal(moves, 1, 'move must retain its original selection');
	onPick = () => { editorData.document.version++; };
	await assert.rejects(registered.get('structural.moveModuleMembers')!(), /The Source Changed/);
	assert.equal(moves, 1, 'editing during target selection must prevent the move');
});


test('test impact picker exports matches, preserves the clipboard for stale results and disposes on close', async () => {
	const realRequire = createRequire(new URL('../out/testImpactView.js', import.meta.url));
	type Item = { label: string; test: { name: string } };
	type Button = { tooltip: string };
	let changed = (_value: string) => {}, hide = () => {};
	let trigger = async (_button: Button) => {};
	let shown!: () => void;
	const ready = new Promise<void>(resolve => { shown = resolve; });
	let disposed = 0, current = true, savedScope = '';
	const copied: string[] = [], errors: string[] = [];
	const disposable = { dispose() { disposed++; } };
	const picker = {
		items: [] as Item[], buttons: [] as Button[], title: '', placeholder: '', selectedItems: [],
		get value() { return ''; }, set value(value: string) { changed(value); },
		onDidAccept: () => disposable,
		onDidHide: (callback: () => void) => { hide = callback; return disposable; },
		onDidChangeValue: (callback: (value: string) => void) => { changed = callback; return disposable; },
		onDidTriggerButton: (callback: (button: Button) => Promise<void>) => { trigger = callback; return disposable; },
		show() { shown(); }, dispose() { disposed++; }
	};
	const api = {
		l10n: { t: (text: string, ...values: (string | number)[]) => text.replace(/\{(\d+)\}/g, (_match, index) => String(values[Number(index)])) },
		ThemeIcon: class {},
		window: { createQuickPick: () => picker, showQuickPick: async () => ({ scope: 'module' }), showErrorMessage: (text: string) => { errors.push(text); } },
		workspace: { asRelativePath: (file: string) => file.replace('/project/', '') },
		env: { clipboard: { writeText: async (text: string) => { copied.push(text); } } }
	};
	const tests = [
		{ name: 'direct case', fileName: '/project/a.test.ts', start: 0, chain: [{ name: 'format' }] },
		{ name: 'adapter case', fileName: '/project/a.test.ts', start: 10, chain: [{ name: 'displayLabel' }] }
	];
	const exported = {} as typeof import('../src/testImpactView.ts');
	runInNewContext(readFileSync(new URL('../out/testImpactView.js', import.meta.url), 'utf8'), {
		exports: exported,
		require: (id: string) => {
			if (id === 'vscode') { return api; }
			if (id === './testImpact') { return { analyzeTestImpact: () => ({ tests, excludedFiles: [] }) }; }
			if (id === './snapshot') { return { projectSnapshot: () => new Map(), sameSnapshot: () => current }; }
			return realRequire(id);
		}
	});
	let action!: (editor: vscode.TextEditor) => Promise<void>;
	exported.registerTestImpact({ workspaceState: { get: () => undefined, update: async (_key: string, value: string) => { savedScope = value; } } } as unknown as vscode.ExtensionContext,
		(_id, callback) => { action = callback; }, (_document, callback) => callback({} as Project));
	const workflow = action({ document: { uri: { fsPath: '/project/a.ts' }, version: 1, offsetAt: () => 0 }, selection: { active: {} } } as unknown as vscode.TextEditor);
	await ready;
	assert.equal(savedScope, 'module');
	changed('displayLabel a.test');
	assert.equal(picker.items.length, 1);
	assert.match(picker.title, /1 of 2/);
	await trigger(picker.buttons[1]);
	assert.match(copied[0], /adapter case/);
	assert.ok(!copied[0].includes('direct case'));
	current = false;
	await trigger(picker.buttons[0]);
	assert.equal(copied.length, 1, 'stale results must not overwrite the clipboard');
	assert.match(errors[0], /The Project Changed/);
	changed('no-match');
	await trigger(picker.buttons[0]);
	assert.equal(copied.length, 1, 'empty matches must not overwrite the clipboard');
	await trigger(picker.buttons[2]);
	assert.equal(picker.items.length, 2);
	current = true;
	await trigger(picker.buttons[0]);
	assert.equal(copied[1], 'a.test.ts', 'matching paths are deduplicated');
	hide(); await workflow;
	assert.equal(disposed, 5);
});


test('reaching-value navigation rejects source edits made while its picker is open', async () => {
	const realRequire = createRequire(new URL('../out/functionFlowView.js', import.meta.url));
	const ts = realRequire('typescript') as typeof import('typescript');
	const source = ts.createSourceFile('a.ts', 'let value = 1;', ts.ScriptTarget.Latest, true);
	const declaration = (source.statements[0] as import('typescript').VariableStatement).declarationList.declarations[0];
	const key = 'value@' + declaration.name.getStart();
	let changeSource = false, navigations = 0;
	const initial = { start: 30, end: 30, active: 30 };
	const editorData = { document: { uri: { fsPath: '/a.ts' }, version: 1, offsetAt: () => 30, positionAt: (offset: number) => offset }, selection: initial, revealRange() { navigations++; } };
	const api = {
		l10n: { t: (text: string) => text }, Disposable: class {},
		Selection: class { start; end; active; constructor(start: number, end: number) { this.start = start; this.end = end; this.active = end; } },
		window: { showQuickPick: async () => { if (changeSource) { editorData.document.version++; } return { id: 1 }; } }
	};
	const exported = {} as typeof import('../src/functionFlowView.ts');
	runInNewContext(readFileSync(new URL('../out/functionFlowView.js', import.meta.url), 'utf8'), {
		exports: exported,
		require: (id: string) => {
			if (id === 'vscode') { return api; }
			if (id === './project') { return { nodeAt: () => declaration, resolvedSymbol: () => ({ declarations: [declaration] }) }; }
			if (id === './controlFlow') { return { analyzeFunction: () => ({ variables: new Map([[key, 'value']]), nodes: [{ id: 0, start: 0, end: 50, uses: [key] }, { id: 1, start: 10, end: 20, label: 'value = 1', uses: [] }], facts: [{ reaching: new Map([[key, new Set([1])]]) }] }) }; }
			return realRequire(id);
		}
	});
	const registered = new Map<string, (editor: vscode.TextEditor) => Promise<void>>();
	exported.registerFunctionFlow({ subscriptions: [] } as unknown as vscode.ExtensionContext,
		(_document, callback) => callback({ program: { getSourceFile: () => source } } as unknown as Project), (id, action) => { registered.set(id, action); });
	const action = registered.get('structural.valueOrigins')!;
	await action(editorData as unknown as vscode.TextEditor);
	assert.equal(editorData.selection.start, 10);
	assert.equal(navigations, 1);
	editorData.selection = initial; changeSource = true;
	await assert.rejects(action(editorData as unknown as vscode.TextEditor), /The Source Changed/);
	assert.equal(editorData.selection, initial);
	assert.equal(navigations, 1);
});
