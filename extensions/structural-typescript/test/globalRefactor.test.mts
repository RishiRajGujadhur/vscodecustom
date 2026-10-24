/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { fixture } from './fixtures.mts';
import { inlineParameterObject, parameterObject, moveMember, validateChanges } from '../out/globalRefactor.js';

test('parameter object updates callers across import aliases and validates the project', () => {
	fixture({ 'model.ts': 'export function sum(a: number, b: number) { return a + b; }', 'use.ts': `import { sum as add } from './model'; export const total = add(1, 2);` }, (project, file) => {
		const changes = parameterObject(project, file, 18);
		assert.deepEqual(changes.map(change => change.text), ['{ a, b }: sumOptions', 'interface sumOptions { a: number; b: number; }\n', '{ a: 1, b: 2 }']);
		validateChanges(project, changes);
	});
});

test('parameter conversion refuses callback references', () => {
	fixture({ 'model.ts': 'function sum(a: number, b: number) { return a + b; } const callback = sum;' }, (project, file) => {
		assert.throws(() => parameterObject(project, file, 10), { code: 'indirectReference' });
	});
});

test('parameter conversion refuses shorthand callback escapes', () => {
	fixture({ 'model.ts': 'function sum(a: number, b: number) { return a + b; } const callbacks = { sum };' }, (project, file) => {
		assert.throws(() => parameterObject(project, file, 10), { code: 'indirectReference' });
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

test('cross-file member moves bring required imports and rebase relative paths', () => {
	const text = 'import type { Tag } from "../types"; import { Base } from "../base"; export interface Child extends Base { tag: Tag; }';
	fixture({ 'child/model.ts': text, 'base.ts': 'export interface Base {}', 'types.ts': 'export interface Tag { value: string }' }, (project, file) => {
		const changes = moveMember(project, file, text.indexOf('tag:'), 'up');
		assert.deepEqual(changes.map(change => change.text.trim()), ['', 'import type { Tag } from "./types";', 'tag: Tag;']);
		validateChanges(project, changes);
	});
});

test('inline parameter object updates callers and removes an unshared options interface', () => {
	const text = 'interface Options { a: number; b: number; } export function sum({ a, b }: Options) { return a + b; }';
	fixture({ 'model.ts': text, 'use.ts': 'import { sum } from "./model"; export const result = sum({ a: 1, b: 2 });' }, (project, file) => {
		const changes = inlineParameterObject(project, file, text.indexOf('sum'));
		assert.deepEqual(changes.map(change => change.text), ['a: number, b: number', '1, 2', '']);
		validateChanges(project, changes);
	});
});

test('inline parameter object refuses to reorder side effects', () => {
	const text = 'function sum({ a, b }: { a: number; b: number }) { return a + b; } sum({ b: 2, a: 1 });';
	fixture({ 'model.ts': text }, (project, file) => {
		assert.throws(() => inlineParameterObject(project, file, text.indexOf('sum')), { code: 'objectCallerOrder' });
	});
});
