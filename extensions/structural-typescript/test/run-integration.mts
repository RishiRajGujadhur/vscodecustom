/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runTests } from '@vscode/test-electron';
import * as ts from 'typescript';

const extensionRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const developmentPath = process.env.STRUCTURAL_EXTENSION_DEV_PATH ?? extensionRoot;
const executable = process.env.VSCODE_EXECUTABLE_PATH ?? process.argv[2];
if (!executable || !fs.existsSync(executable)) { throw new Error('Provide an existing Code OSS/VS Code executable as the first argument or VSCODE_EXECUTABLE_PATH.'); }
const runRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'structural-integration-'));
const workspace = path.join(runRoot, 'workspace');
fs.mkdirSync(workspace);
fs.writeFileSync(path.join(workspace, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, module: 'esnext', target: 'es2022' }, include: ['*.ts'] }));
fs.writeFileSync(path.join(workspace, 'sample.ts'), 'export function greet(flag:boolean){return flag===true;}\nexport function price(premium:boolean){let discount=0;if(premium){discount=20;}return 100-discount;}\nfunction used(){return 1;}\nused();\n');
console.log(`Isolated integration profile: ${runRoot}`);
const testEntry = path.join(runRoot, 'integration.cjs');
fs.writeFileSync(testEntry, ts.transpileModule(fs.readFileSync(path.join(extensionRoot, 'test/integration.cts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText);
await runTests({ vscodeExecutablePath: executable, extensionDevelopmentPath: developmentPath, extensionTestsPath: testEntry, extensionTestsEnv: { STRUCTURAL_SOURCE_EXTENSION_PATH: extensionRoot, STRUCTURAL_EXTENSION_DEV_PATH: developmentPath }, launchArgs: [workspace, `--user-data-dir=${path.join(runRoot, 'user-data')}`, `--extensions-dir=${path.join(runRoot, 'extensions')}`, `--shared-data-dir=${path.join(runRoot, 'shared-data')}`, '--disable-workspace-trust', '--disable-extension=GitHub.copilot-chat', '--skip-welcome', '--skip-release-notes', '--locale=en'] });
// Remove only this freshly created, absolute temporary test directory.
const resolved = path.resolve(runRoot);
if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('structural-integration-')) { throw new Error('Refusing unexpected integration cleanup path.'); }
fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 5 });
