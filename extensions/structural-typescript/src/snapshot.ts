/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { Project } from './project';
import * as ts from 'typescript';

/** Source graph snapshot used by workflows that wait for interactive input. */
export function projectSnapshot(project: Project): ReadonlyMap<string, string> {
	const snapshot = new Map(project.program.getSourceFiles().filter(file => !file.isDeclarationFile && !project.program.isSourceFileFromExternalLibrary(file)).map(file => {
		const normalized = file.fileName.replace(/\\/g, '/');
		return [ts.sys.useCaseSensitiveFileNames ? normalized : normalized.toLowerCase(), file.text];
	}));
	snapshot.set('\0options', JSON.stringify(project.program.getCompilerOptions()));
	return snapshot;
}
export function sameSnapshot(project: Project, expected: ReadonlyMap<string, string>): boolean {
	const current = projectSnapshot(project);
	return current.size === expected.size && [...current].every(([file, text]) => expected.get(file) === text);
}
