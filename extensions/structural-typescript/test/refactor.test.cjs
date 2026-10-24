/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Project } = require('../out/project');
const { extractComponent, rename } = require('../out/refactor');

function fixture(files, action) {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'structure-'));
	try {
		fs.writeFileSync(path.join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { jsx: 'preserve', strict: true }, include: ['*'] }));
		for (const [name, text] of Object.entries(files)) { fs.writeFileSync(path.join(root, name), text); }
		const file = path.join(root, Object.keys(files)[0]);
		const project = new Project(file, new Map());
		try { action(project, file, root); } finally { project.dispose(); }
	} finally { fs.rmSync(root, { recursive: true, force: true }); }
}

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
		assert.throws(() => extractComponent(project, file, source.indexOf('<div>'), source.indexOf(';', source.indexOf('<div>')), 'Counter'), /mutations/);
		assert.throws(() => extractComponent(project, file, source.indexOf('<div>') + 1, source.length, 'Counter'), /complete JSX/);
	});
});

test('renames cross-file symbols while leaving unrelated identifiers intact', () => {
	fixture({ 'model.ts': 'export const value = 1;', 'use.ts': "import { value } from './model'; console.log(value); const other = { value: 2 };" }, (project, file) => {
		const changes = rename(project, file, 14, 'renamed', false);
		assert.deepEqual(changes.map(change => path.basename(change.fileName)).sort(), ['model.ts', 'use.ts', 'use.ts']);
	});
});

module.exports = { fixture };
