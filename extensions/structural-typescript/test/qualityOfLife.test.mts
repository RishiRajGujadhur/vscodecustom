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
		languages: { createDiagnosticCollection: () => ({ ...disposable, clear() {}, set() {} }) },
		env: { clipboard: { writeText: async (text: string) => { copied.push(text); } } },
		window: { showQuickPick: async () => [{ fileName: '/project/a.ts' }], showInformationMessage: (text: string) => { messages.push(text); } },
		workspace: {
			textDocuments: [], asRelativePath: (file: string | { fsPath: string }) => (typeof file === 'string' ? file : file.fsPath).replace('/project/', ''),
			onDidChangeTextDocument: (callback: () => void) => { edited = callback; return disposable; },
			onDidCreateFiles: () => disposable, onDidDeleteFiles: () => disposable, onDidRenameFiles: () => disposable,
			openTextDocument: async () => ({ uri: { fsPath: '/project/a.ts' }, getText: () => 'export const unused = 1;', positionAt: (offset: number) => ({ line: 0, character: offset }) })
		}
	};
	const project = { directory: '/project', program: { getSourceFiles: () => [{ fileName: '/project/a.ts' }], isSourceFileFromExternalLibrary: () => false } } as unknown as Project;
	const exported = {} as typeof import('../src/projectToolsView.ts');
	runInNewContext(readFileSync(new URL('../out/projectToolsView.js', import.meta.url), 'utf8'), {
		exports: exported,
		require: (id: string) => {
			if (id === 'vscode') { return api; }
			if (id === './testImpactView') { return { registerTestImpact() {} }; }
			if (id === './snapshot') { return { projectSnapshot: () => new Map(), snapshotText: () => 'export const unused = 1;' }; }
			if (id === './project') { return { Project: class { dispose() {} } }; }
			if (id === './deadCode') { return { findDeadCode: () => [{ fileName: '/project/a.ts', start: 13, length: 6, name: 'unused', kind: 'export' }] }; }
			if (id === './nullability') { return { analyzeNullability: () => [{ fileName: '/project/a.ts', start: 13, length: 6, message: 'Possibly undefined', code: 18048, trace: [{ fileName: '/project/a.ts', start: 0, length: 6, kind: 'source', text: 'maybe()' }] }] }; }
			return realRequire(id);
		}
	});
	const editor = { document: { uri: { fsPath: '/project/a.ts' } } } as vscode.TextEditor;
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
});
