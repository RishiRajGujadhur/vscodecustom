/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import { fixture } from './fixtures.mts';
import { changeSignature, SignatureError } from '../out/changeSignature.js';
import { safeDelete, safeDeleteFile } from '../out/safeDelete.js';
import { analyzeFunction, UnsupportedFlow } from '../out/controlFlow.js';
import { intentionsAt } from '../out/intentions.js';
import { documentChange, documentOffset } from '../out/documentEdits.js';

test('signature review: removing an effectful default must be refused', () => {
	const code = 'function effect(){return 1;} export function f(unused = effect(), value = 2){return value;} f(undefined,3);';
	fixture({ 'a.ts': code }, (project, file) => {
		assert.throws(() => changeSignature(project, file, code.indexOf('f('), [{ originalIndex: 1, name: 'value' }]), (error: Error) => error instanceof SignatureError && error.code === 'effects');
	});
});

test('signature review: mts declarations retain parameter types', () => fixture({
	'a.ts': 'import { f } from "./module.mjs"; f(1);',
	'module.mts': 'export function f(value: number){return value;}'
}, (project, _file, root) => {
	const result = changeSignature(project, path.join(root, 'module.mts'), 16, [{ originalIndex: 0, name: 'count' }]);
	assert.ok(result.changes.some(change => change.text === 'count: number'));
}));

for (const code of [
	'function name(){return "run";} class Unused { [name()](){} } export {};',
	'function decorate(value: object, context: ClassMethodDecoratorContext){} class Unused { @decorate run(){} } export {};'
]) {
	test('delete review: class evaluation effects block deletion: ' + code.slice(0, 25), () => fixture({ 'a.ts': code }, (project, file) => {
		assert.ok(safeDelete(project, file, code.indexOf('Unused')).risks.includes('sideEffects'));
	}));
}

test('delete review: local declaration consumers block deleting their module', () => fixture({
	'a.ts': 'export interface Value { text: string }',
	'consumer.d.ts': 'export { Value } from "./a";'
}, (project, file) => {
	assert.ok(safeDeleteFile(project, file).usages.some(usage => usage.kind === 'blocking' && usage.fileName.endsWith('consumer.d.ts')));
}));

test('flow review: relational keyword operators do not write their left operand', () => {
	const code = 'function f(key: string, object: object){ key in object; if(key in object){return key;} return key; }';
	fixture({ 'a.ts': code }, (project, file) => {
		const flow = analyzeFunction(project, file, code.indexOf('key in'));
		assert.deepEqual(flow.nodes.find(node => node.label === 'key in object;')!.writes, []);
	});
});

test('flow review: bracket writes and increments are retained as mutation sites', () => {
	const code = 'function f(items: number[]){items[0] = 1; items[0]++; return items[0];}';
	fixture({ 'a.ts': code }, (project, file) => {
		assert.deepEqual(analyzeFunction(project, file, code.indexOf('items[0]')).mutations.map(item => item.text), ['items[0] = 1', 'items[0]++']);
	});
});

test('flow review: unsupported destructuring writes fail explicitly', () => {
	const code = 'function f(){let value: number; [value] = [1]; return value;}';
	fixture({ 'a.ts': code }, (project, file) => {
		assert.throws(() => analyzeFunction(project, file, code.indexOf('let')), UnsupportedFlow);
	});
});

test('intentions review: guard clause cannot escape an unbraced outer branch', () => {
	const code = 'function f(outer:boolean, inner:boolean){if(outer) if(inner){return 1;}else{return 2;} return 3;}';
	fixture({ 'a.ts': code }, (project, file) => {
		assert.equal(intentionsAt(project, file, code.indexOf('if(inner)')).some(action => action.rule.id === 'guardClause'), false);
	});
});

test('intentions review: repeated ambient reads may invoke getters and cannot be extracted', () => {
	const code = 'declare const externalValue: number; function f(){return (externalValue + 1) * (externalValue + 1);}';
	fixture({ 'a.ts': code }, (project, file) => {
		assert.equal(intentionsAt(project, file, code.indexOf('return')).some(action => action.rule.id === 'extractRepeated'), false);
	});
});


test('delete review: known local declaration references also block deleting a symbol', () => fixture({
	'a.ts': 'export interface Value { text: string }',
	'consumer.d.ts': 'import { Value } from "./a"; export interface Consumer { value: Value }'
}, (project, file) => {
	assert.ok(safeDelete(project, file, 20).usages.some(usage => usage.kind === 'blocking' && usage.fileName.endsWith('consumer.d.ts')));
}));

test('flow review: property deletion is a mutation', () => {
	const code = 'function f(object: {key?: number}){delete object.key; return object;}';
	fixture({ 'a.ts': code }, (project, file) => {
		assert.deepEqual(analyzeFunction(project, file, code.indexOf('delete')).mutations.map(item => item.text), ['delete object.key']);
	});
});

test('signature review: deleting a literal default and keeping another remains supported', () => {
	const code = 'export function f(unused = 1, value = 2){return value;} f(undefined,3);';
	fixture({ 'a.ts': code }, (project, file) => {
		const result = changeSignature(project, file, code.indexOf('f('), [{ originalIndex: 1, name: 'value' }]);
		assert.deepEqual([result.callers, result.changes.map(change => change.text)], [1, ['value = 2', '3']]);
	});
});


test('preview review: mixed EOL normalization maps offsets without accepting content changes', () => {
	const original = 'first\r\nsecond\nthird\r\nfourth';
	const current = original.replaceAll('\r\n', '\n');
	const change = documentChange({ fileName: 'a.ts', start: original.indexOf('third'), length: 5, text: 'updated', documentText: original }, current)!;
	const restored = documentOffset(current, original, current.indexOf('third'));
	assert.deepEqual([change.start, current.slice(change.start, change.start + change.length), restored, documentChange({ ...change, documentText: original }, current + '!')], [current.indexOf('third'), 'third', original.indexOf('third'), undefined]);
});
