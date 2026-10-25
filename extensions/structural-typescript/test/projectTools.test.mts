/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Project } from '../out/project.js';
import { moveModuleMembers } from '../out/moduleMembers.js';

function fixture(files: Record<string, string>, action: (project: Project, root: string) => void): void {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'project-tools-'));
	fs.writeFileSync(path.join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, target: 'es2022', module: 'esnext', moduleResolution: 'bundler', types: [] }, include: ['*.ts', '*.tsx'] }));
	for (const [name, text] of Object.entries(files)) { fs.writeFileSync(path.join(root, name), text); }
	const project = new Project(path.join(root, 'a.ts'), new Map());
	try { action(project, root); } finally { project.dispose(); assert.equal(path.dirname(root), os.tmpdir()); fs.rmSync(root, { recursive: true, force: true }); }
}

test('module move migrates aliased consumers, dependencies and retained source uses', () => fixture({
	'a.ts': 'const prefix = "Hello ";\nexport function greet(name: string) { return prefix + name; }\nexport const message = greet("world");',
	'b.ts': 'export const version = 1;',
	'c.ts': 'import { greet as hello } from "./a"; console.log(hello("Ada"));'
}, (project, root) => {
	const changes = moveModuleMembers(project, path.join(root, 'a.ts'), 45, 45, path.join(root, 'b.ts'));
	const updated = (name: string) => {
		let text = fs.readFileSync(path.join(root, name), 'utf8');
		for (const edit of changes.filter(edit => path.resolve(edit.fileName) === path.join(root, name)).sort((a, b) => b.start - a.start)) { text = text.slice(0, edit.start) + edit.text + text.slice(edit.start + edit.length); }
		return text;
	};
	assert.deepEqual([updated('a.ts').includes('export function greet'), updated('b.ts').includes('export function greet'), /from ["']\.\/b["']/.test(updated('c.ts'))], [false, true, true]);
}));

test('module move refuses incompatible module directives', () => fixture({ 'a.ts': '"use client"; export const value = 1;', 'b.ts': 'export {};' }, (project, root) => {
	assert.throws(() => moveModuleMembers(project, path.join(root, 'a.ts'), 26, 26, path.join(root, 'b.ts')), /moveDirectives/);
}));
