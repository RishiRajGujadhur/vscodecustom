/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { fixture } from './fixtures.mts';
import { flowTree, hierarchyRelations, symbolAt, typeTree, unusedDiagnostics } from '../out/analysis.js';

test('type dependencies include inheritance, intersections and union branches', () => {
	const text = 'interface Base {} interface Child extends Base {} type Both = Base & Child; type Either = Base | Child;';
	fixture({ 'model.ts': text }, (project, file) => {
		const base = symbolAt(project, file, text.indexOf('Base'))!;
		assert.deepEqual(typeTree(project, base, true)!.children.map(node => node.label), ['Child', 'Both', 'Either']);
	});
});

test('value flow follows assignments and resolved function parameters in both directions', () => {
	const text = 'const input = 1; const next = input; function take(value: number) { return value; } const output = take(next);';
	fixture({ 'model.ts': text }, (project, file) => {
		const next = symbolAt(project, file, text.indexOf('next'))!;
		assert.deepEqual({ from: flowTree(project, next, false)!.children.map(node => node.label), to: flowTree(project, next, true)!.children.map(node => node.label) }, { from: ['output', 'value'], to: ['input'] });
	});
});

test('native hierarchy distinguishes inheritance from property dependencies', () => {
	const text = 'interface Base {} interface Child extends Base {} class Impl implements Base {} interface Holder { item: Base; }';
	fixture({ 'model.ts': text }, (project, file) => {
		assert.deepEqual(hierarchyRelations(project, symbolAt(project, file, text.indexOf('Base'))!, true).map(symbol => symbol.name), ['Child', 'Impl']);
	});
});

test('unused analysis follows dynamic imports without marking used declarations', () => {
	fixture({ 'model.ts': 'export {}; const unused = 1; async function load() { return import("./lazy"); } export { load };', 'lazy.ts': 'export const used = 1;' }, (project) => {
		assert.deepEqual(unusedDiagnostics(project).map(diagnostic => diagnostic.file!.text.slice(diagnostic.start!, diagnostic.start! + diagnostic.length!)), ['unused']);
	});
});

test('reports possible unread internal fields and statically constant typeof guards', () => {
	const text = 'export {}; interface Internal { used: string; unread: number; } function read(item: Internal) { if (typeof item.used === "string") { return item.used; } }';
	fixture({ 'model.ts': text }, project => {
		assert.deepEqual(unusedDiagnostics(project).filter(diagnostic => diagnostic.code >= 98000).map(diagnostic => [diagnostic.code, diagnostic.file!.text.slice(diagnostic.start!, diagnostic.start! + diagnostic.length!)]), [[98002, 'typeof item.used === "string"'], [98001, 'unread']]);
	});
});

test('does not flag dynamically accessed or publicly exported interface fields', () => {
	fixture({ 'model.ts': 'export {}; interface Internal { field: string; } interface Public { field: string; } export { Public }; function read(item: Internal, key: keyof Internal) { return item[key]; }' }, project => {
		assert.deepEqual(unusedDiagnostics(project).filter(diagnostic => diagnostic.code === 98001), []);
	});
});
