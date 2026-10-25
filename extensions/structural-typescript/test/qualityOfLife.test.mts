/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
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
