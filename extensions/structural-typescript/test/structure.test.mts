/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as ts from 'typescript';
import { structure, type StructureNode } from '../out/structure.js';

test('structure preserves hooks, conditional branches and iteration nesting', () => {
	const source = ts.createSourceFile('app.tsx', 'function App() { const [items] = useState([]); return <main>{items.length && items.map(item => <Card>{item}</Card>)}</main>; }', ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
	const rows: Array<[number, string, string]> = [];
	const flatten = (nodes: readonly StructureNode[], depth = 0): void => nodes.forEach(node => { rows.push([depth, node.kind, node.label]); flatten(node.children, depth + 1); });
	flatten(structure(source));
	assert.deepEqual(rows, [
		[0, 'declaration', 'App'], [1, 'declaration', '[items]'], [2, 'hook', 'useState'],
		[1, 'component', '<main>'], [2, 'branch', 'items.length &&'], [3, 'iteration', 'items.map(…)'], [4, 'component', '<Card>']
	]);
});
