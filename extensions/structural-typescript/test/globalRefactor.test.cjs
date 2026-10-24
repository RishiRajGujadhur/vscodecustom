/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fixture } = require('./refactor.test.cjs');
const { parameterObject, moveMember, validateChanges } = require('../out/globalRefactor');

test('parameter object updates callers across import aliases and validates the project', () => {
	fixture({ 'model.ts': 'export function sum(a: number, b: number) { return a + b; }', 'use.ts': "import { sum as add } from './model'; export const total = add(1, 2);" }, (project, file) => {
		const changes = parameterObject(project, file, 18);
		assert.deepEqual(changes.map(change => change.text), ['{ a, b }: sumOptions', 'interface sumOptions { a: number; b: number; }\n', '{ a: 1, b: 2 }']);
		validateChanges(project, changes);
	});
});

test('parameter conversion refuses callback references', () => {
	fixture({ 'model.ts': 'function sum(a: number, b: number) { return a + b; } const callback = sum;' }, (project, file) => {
		assert.throws(() => parameterObject(project, file, 10), /indirect references/);
	});
});

test('pull member up moves a declaration to its resolved parent', () => {
	const text = 'interface Base {} interface Child extends Base { title: string; }';
	fixture({ 'model.ts': text }, (project, file) => {
		const changes = moveMember(project, file, text.indexOf('title'), 'up');
		assert.deepEqual(changes.map(change => change.text.trim()), ['', 'title: string;']);
		validateChanges(project, changes);
	});
});

test('moving an implementation with an inaccessible dependency is rejected', () => {
	const text = 'class Base {} class Child extends Base { field = 1; value() { return this.field; } }';
	fixture({ 'model.ts': text }, (project, file) => {
		assert.throws(() => validateChanges(project, moveMember(project, file, text.indexOf('value'), 'up')), /field/);
	});
});
