/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import { fixture } from './fixtures.mts';
import { extractComponent, rename, textReferenceChanges } from '../out/refactor.js';
import { validateChanges } from '../out/globalRefactor.js';

test('extracts closure values, preserves client directive and imports', () => {
	const source = `'use client';\nimport { Widget } from './widget';\nfunction App({ title }: { title: string }) { return <Widget title={title} />; }`;
	fixture({ 'app.tsx': source }, (project, file) => {
		const jsx = '<Widget title={title} />';
		const result = extractComponent(project, file, source.indexOf(jsx), source.indexOf(jsx) + jsx.length, 'Header');
		assert.deepEqual({ props: result.content.includes('title: string;'), directive: result.content.startsWith("'use client';"), replacement: result.changes[0].text }, { props: true, directive: true, replacement: '<Header title={title} />' });
	});
});

test('refuses mutation and partial selections', () => {
	const source = 'let count = 0; const view = <div>{count++}</div>;';
	fixture({ 'app.tsx': source }, (project, file) => {
		assert.throws(() => extractComponent(project, file, source.indexOf('<div>'), source.indexOf(';', source.indexOf('<div>')), 'Counter'), { code: 'unsafeSelection' });
		assert.throws(() => extractComponent(project, file, source.indexOf('<div>') + 1, source.length, 'Counter'), { code: 'invalidSelection' });
	});
});

test('renames cross-file symbols while leaving unrelated identifiers intact', () => {
	fixture({ 'model.ts': 'export const value = 1;', 'use.ts': "import { value } from './model'; console.log(value); const other = { value: 2 };" }, (project, file) => {
		const changes = rename(project, file, 14, 'renamed', false);
		assert.deepEqual(changes.map(change => path.basename(change.fileName)).sort(), ['model.ts', 'use.ts', 'use.ts']);
	});
});

test('validates both the new module and rewritten source before extraction', () => {
	const source = 'export function App({title}: {title: string}) { return <span>{title}</span>; }';
	fixture({ 'app.tsx': source, 'jsx.d.ts': 'declare namespace JSX { interface Element {} interface IntrinsicElements { span: { children?: string }; } }' }, (project, file) => {
		const jsx = '<span>{title}</span>';
		const result = extractComponent(project, file, source.indexOf(jsx), source.indexOf(jsx) + jsx.length, 'Header');
		assert.doesNotThrow(() => validateChanges(project, result.changes, new Map([[result.fileName, result.content]]), true));
	});
});

test('preserves shorthand closure values and inferred imported prop types', () => {
	const source = 'import { box } from "./types"; const value = box(); const count = 1; const view = <Widget value={value} data={{ count }} />;';
	fixture({ 'app.tsx': source, 'types.ts': 'export interface Box { value: string } export function box(): Box { return { value: "a" }; }' }, (project, file) => {
		const jsx = '<Widget value={value} data={{ count }} />';
		const result = extractComponent(project, file, source.indexOf(jsx), source.indexOf(jsx) + jsx.length, 'Card');
		assert.deepEqual({ imported: result.content.includes('import("./types").Box'), shorthand: result.content.includes('count: number;') }, { imported: true, shorthand: true });
	});
});

test('refuses extraction that would change React key behavior', () => {
	const source = 'const id = 1; const view = <div key={id} />;';
	fixture({ 'app.tsx': source }, (project, file) => {
		assert.throws(() => extractComponent(project, file, source.indexOf('<div'), source.indexOf('/>') + 2, 'Item'), { code: 'rootKey' });
	});
});

test('workspace text matching respects identifier boundaries and escapes regex syntax', () => {
	assert.deepEqual(textReferenceChanges('style.css', '.Card { } /* Card CardMore $Card */', 'Card', 'Panel').map(change => change.start), [1, 13]);
	assert.deepEqual(textReferenceChanges('view.html', '<div>$value $valueMore</div>', '$value', 'renamed').map(change => change.start), [5]);
});

