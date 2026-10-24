/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as fs from 'fs';
import * as path from 'path';

/** Leaves space for Setup's temporary names within the legacy Win32 path limit. */
export function getUnsafeWindowsInstallerPaths(files: readonly string[], installDirectory: string): string[] {
	const temporaryNameAllowance = 16;
	return files.filter(file => path.win32.join(installDirectory, file).length + temporaryNameAllowance >= 260);
}

export function assertWindowsInstallerPaths(sourceDirectory: string, installDirectory: string): void {
	const files = fs.readdirSync(sourceDirectory, { recursive: true, withFileTypes: true })
		.filter(entry => entry.isFile())
		.map(entry => path.relative(sourceDirectory, path.join(entry.parentPath, entry.name)));
	const unsafe = getUnsafeWindowsInstallerPaths(files, installDirectory);
	if (unsafe.length) {
		throw new Error(`The Windows installer contains ${unsafe.length} paths that exceed the safe rename limit at ${installDirectory}. Flatten or bundle these dependencies before packaging:\n${unsafe.slice(0, 5).join('\n')}`);
	}
}
