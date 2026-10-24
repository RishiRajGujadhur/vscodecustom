/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fixture } = require('./refactor.test.cjs');
const { flowTree, symbolAt, typeTree, unusedDiagnostics } = require('../out/analysis');

test('type dependencies include inheritance, intersections and union branches', () => {
	const text = 'interface Base {} interface Child extends Base {} type Both = Base & Child; type Either = Base | Child;';
	fixture({ 'model.ts': text }, (project, file) => {
		const base = symbolAt(project, file, text.indexOf('Base'));
		assert.deepEqual(typeTree(project, base, true).children.map(node => node.label), ['Child', 'Both', 'Either']);
	});
});

test('value flow follows assignments and resolved function parameters in both directions', () => {
	const text = 'const input = 1; const next = input; function take(value: number) { return value; } const output = take(next);';
	fixture({ 'model.ts': text }, (project, file) => {
		const next = symbolAt(project, file, text.indexOf('next'));
		assert.deepEqual({ from: flowTree(project, next, false).children.map(node => node.label), to: flowTree(project, next, true).children.map(node => node.label) }, { from: ['output', 'value'], to: ['input'] });
	});
});

test('unused analysis follows dynamic imports without marking used declarations', () => {
	fixture({ 'model.ts': 'export {}; const unused = 1; async function load() { return import("./lazy"); } export { load };', 'lazy.ts': 'export const used = 1;' }, (project) => {
		assert.deepEqual(unusedDiagnostics(project).map(diagnostic => diagnostic.file.text.slice(diagnostic.start, diagnostic.start + diagnostic.length)), ['unused']);
	});
});
