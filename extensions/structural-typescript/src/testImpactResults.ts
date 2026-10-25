/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import type { ImpactedTest } from './testImpact';

/** Matches every search word across test titles, displayed paths and dependency chains. */
export function matchingImpactTests(tests: readonly ImpactedTest[], query: string, displayPath: (fileName: string) => string): readonly ImpactedTest[] {
	const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
	return words.length ? tests.filter(test => {
		const text = [test.name, displayPath(test.fileName), ...test.chain.map(step => step.name)].join(' ').toLowerCase();
		return words.every(word => text.includes(word));
	}) : tests;
}

/** Deduplicates file paths after filtering, preserving result order. */
export function impactFilePaths(tests: readonly ImpactedTest[], displayPath: (fileName: string) => string): readonly string[] {
	return [...new Set(tests.map(test => displayPath(test.fileName)))];
}
