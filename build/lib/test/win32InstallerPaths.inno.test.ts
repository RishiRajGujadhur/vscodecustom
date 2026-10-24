/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import assert from 'assert';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createRequire } from 'module';
import { test } from 'node:test';

test('Inno reproduces the reported long-path failure and installs replacement payload paths', { skip: process.platform !== 'win32' }, context => {
	const workspace = path.resolve(import.meta.dirname, '../../..');
	const expectedInstallDirectory = 'C:\\Users\\user\\AppData\\Local\\Programs\\Microsoft Code OSS';
	const prefix = path.join(workspace, '.build', 'path-probe-');
	if (prefix.length > expectedInstallDirectory.length - 6) { context.skip('Workspace path is too long for a matching destination-length probe.'); return; }
	const installDirectory = fs.mkdtempSync(prefix.padEnd(expectedInstallDirectory.length - 6, 'x'));
	const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'vscode-inno-path-probe-'));
	const require = createRequire(import.meta.url);
	const compiler = path.join(path.dirname(path.dirname(require.resolve('innosetup'))), 'bin', 'ISCC.exe');
	const source = path.join(temporaryDirectory, 'payload.txt');
	const quote = (text: string) => text.replace(/"/g, '""');
	const run = (executable: string, args: string[]) => spawnSync(executable, args, { encoding: 'utf8', windowsHide: true, timeout: 30000 });
	const build = (files: string[], name: string): string => {
		const script = path.join(temporaryDirectory, `${name}.iss`);
		fs.writeFileSync(script, [
			'[Setup]', 'AppId=CodeOSSInstallerPathProbe', 'AppName=Code OSS Path Probe', 'AppVersion=1.0',
			`DefaultDirName=${installDirectory}`, 'PrivilegesRequired=lowest', 'Uninstallable=no',
			'CreateUninstallRegKey=no', 'SetupMutex=CodeOSSInstallerPathProbe', 'DisableDirPage=yes',
			'DisableProgramGroupPage=yes', `OutputDir=${temporaryDirectory}`, `OutputBaseFilename=${name}`,
			'[Files]', ...files.map(file => `Source: "${quote(source)}"; DestDir: "{app}\\${quote(path.win32.dirname(file))}"; DestName: "${quote(path.win32.basename(file))}"; Flags: ignoreversion`)
		].join('\n'));
		const result = run(compiler, [script]);
		assert.strictEqual(result.status, 0, result.stderr || result.stdout);
		return path.join(temporaryDirectory, `${name}.exe`);
	};
	const install = (executable: string, log: string) => run(executable, ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', `/LOG=${log}`]);
	try {
		fs.writeFileSync(source, 'first payload');
		const reportedPath = 'resources/app/extensions/copilot/node_modules/@opentelemetry/exporter-metrics-otlp-grpc/node_modules/@opentelemetry/resources/build/esnext/detectors/platform/node/machine-id/getMachineId-unsupported.js.map';
		const log = path.join(temporaryDirectory, 'reported-failure.log');
		const failure = install(build([reportedPath], 'reported-failure'), log);
		assert.notStrictEqual(failure.status, 0, 'The original overlong path must reproduce the installation failure.');
		assert.match(fs.readFileSync(log, 'utf8'), /MoveFile failed; code 3/);
		const payloadRoot = process.env['VSCODE_INNO_TEST_SOURCE_DIR'];
		const files = payloadRoot
			? fs.readdirSync(payloadRoot, { recursive: true, withFileTypes: true }).filter(entry => entry.isFile()).map(entry => path.relative(payloadRoot, path.join(entry.parentPath, entry.name))).sort((a, b) => b.length - a.length).slice(0, 20)
			: ['resources/app/extensions/structural-typescript/dist/extension.js', 'resources/app/extensions/copilot/node_modules/@github/copilot/sdk/index.js'];
		assert.ok(files.length > 0);
		const first = install(build(files, 'fixed-first'), path.join(temporaryDirectory, 'fixed-first.log'));
		assert.strictEqual(first.status, 0, first.stderr || first.stdout);
		fs.writeFileSync(source, 'replacement payload with different length');
		const replacement = install(build(files, 'fixed-replacement'), path.join(temporaryDirectory, 'fixed-replacement.log'));
		assert.strictEqual(replacement.status, 0, replacement.stderr || replacement.stdout);
		assert.deepStrictEqual(files.map(file => fs.readFileSync(path.join(installDirectory, file), 'utf8')), files.map(() => 'replacement payload with different length'));
	} finally {
		// Both paths are newly created by this test; never touch the real application install.
		assert.ok(installDirectory.startsWith(path.join(workspace, '.build') + path.sep));
		assert.ok(temporaryDirectory.startsWith(os.tmpdir() + path.sep));
		fs.rmSync(installDirectory, { recursive: true, force: true });
		fs.rmSync(temporaryDirectory, { recursive: true, force: true });
	}
});
