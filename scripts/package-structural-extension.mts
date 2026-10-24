/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const extension = path.join(root, 'extensions/structural-typescript');
const manifest = JSON.parse(fs.readFileSync(path.join(extension, 'package.json'), 'utf8'));
const releases = path.join(root, '.build/releases');
fs.mkdirSync(releases, { recursive: true });
const stageParent = path.join(root, '.build/structural-vsix');
fs.mkdirSync(stageParent, { recursive: true });
const stage = fs.mkdtempSync(path.join(stageParent, 'package-'));
const build = spawnSync(process.execPath, [path.join(extension, 'esbuild.mts'), '--outputRoot', stage], { cwd: root, stdio: 'inherit' });
if (build.status !== 0) { throw new Error('Extension bundling failed.'); }
manifest.main = './dist/extension.js';
delete manifest.dependencies;
delete manifest.devDependencies;
delete manifest.scripts;
manifest.repository = { type: 'git', url: 'https://github.com/RishiRajGujadhur/vscodecustom.git' };
manifest.files = ['dist/**', 'package.nls.json', 'README.md', 'LICENSE.txt', 'TypeScript-*.txt'];
fs.writeFileSync(path.join(stage, 'package.json'), JSON.stringify(manifest, null, '\t'));
for (const file of ['README.md', 'package.nls.json']) { fs.copyFileSync(path.join(extension, file), path.join(stage, file)); }
fs.copyFileSync(path.join(root, 'LICENSE.txt'), path.join(stage, 'LICENSE.txt'));
fs.copyFileSync(path.join(extension, 'node_modules/typescript/LICENSE.txt'), path.join(stage, 'TypeScript-LICENSE.txt'));
fs.copyFileSync(path.join(extension, 'node_modules/typescript/ThirdPartyNoticeText.txt'), path.join(stage, 'TypeScript-ThirdPartyNotices.txt'));
const require = createRequire(path.join(root, 'build/package.json'));
const { createVSIX } = require('@vscode/vsce');
const packagePath = path.join(releases, `structural-typescript-${manifest.version}.vsix`);
await createVSIX({ cwd: stage, packagePath, dependencies: false, baseContentUrl: 'https://github.com/RishiRajGujadhur/vscodecustom/blob/main/extensions/structural-typescript/', baseImagesUrl: 'https://raw.githubusercontent.com/RishiRajGujadhur/vscodecustom/main/extensions/structural-typescript/' });
console.log(JSON.stringify({ packagePath, extensionDevelopmentPath: stage }));
