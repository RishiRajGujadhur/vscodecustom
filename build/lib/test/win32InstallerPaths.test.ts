/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { test } from 'node:test';
import { assertWindowsInstallerPaths, getUnsafeWindowsInstallerPaths } from '../win32InstallerPaths.ts';

const installDirectory = 'C:\\Users\\user\\AppData\\Local\\Programs\\Microsoft Code OSS';
const failingPath = 'resources/app/extensions/copilot/node_modules/@opentelemetry/exporter-metrics-otlp-grpc/node_modules/@opentelemetry/resources/build/esnext/detectors/platform/node/machine-id/getMachineId-unsupported.js.map';

test('detects the reported installer failure and reserves temporary rename space', () => {
	const boundaryPath = 'x'.repeat(260 - installDirectory.length - 1 - 16);
	assert.deepStrictEqual(getUnsafeWindowsInstallerPaths(['resources/app/extensions/structural-typescript/dist/extension.js', failingPath, boundaryPath], installDirectory), [failingPath, boundaryPath]);
});

test('validates actual payload files before invoking Inno Setup', () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vscode-installer-paths-'));
	try {
		assert.doesNotThrow(() => assertWindowsInstallerPaths(root, installDirectory));
		const file = path.join(root, failingPath);
		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.writeFileSync(file, '{}');
		assert.throws(() => assertWindowsInstallerPaths(root, installDirectory), /safe rename limit/);
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
});
