/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { Change } from './refactor';

function normalize(text: string): string { return text.replace(/\r\n|\r/g, '\n'); }

/** Maps compiler offsets to editor text when opening a file normalizes mixed line endings. */
export function documentOffset(expected: string, actual: string, offset: number): number | undefined {
	if (offset < 0 || offset > expected.length || offset > 0 && expected[offset - 1] === '\r' && expected[offset] === '\n') { return undefined; }
	if (expected === actual) { return offset; }
	if (normalize(expected) !== normalize(actual)) { return undefined; }
	const logical = normalize(expected.slice(0, offset)).length;
	let position = 0;
	for (let index = 0; index < logical; index++) { position += actual[position] === '\r' && actual[position + 1] === '\n' ? 2 : 1; }
	return position;
}

/** Refuses real content changes while preserving ranges across editor EOL normalization. */
export function documentChange(change: Change, actual: string): Change | undefined {
	if (change.documentText === undefined) { return change; }
	const start = documentOffset(change.documentText, actual, change.start);
	const end = documentOffset(change.documentText, actual, change.start + change.length);
	return start === undefined || end === undefined ? undefined : { ...change, start, length: end - start, documentText: actual };
}
