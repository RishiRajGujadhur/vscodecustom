/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as path from 'node:path';
import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import { run } from '../esbuild-extension-common.mts';

const require = createRequire(import.meta.url);
run({ platform: 'node', entryPoints: { extension: path.join(import.meta.dirname, 'src/extension.ts') }, srcDir: path.join(import.meta.dirname, 'src'), outdir: path.join(import.meta.dirname, 'dist') }, process.argv, outDir => {
	const libDir = path.dirname(require.resolve('typescript'));
	for (const file of fs.readdirSync(libDir)) {
		if (/^lib.*\.d\.ts$/.test(file)) { fs.copyFileSync(path.join(libDir, file), path.join(outDir, file)); }
	}
});
