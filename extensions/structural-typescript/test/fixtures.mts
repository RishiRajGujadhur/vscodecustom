/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Project } from '../out/project.js';

export function fixture(files: Record<string, string>, action: (project: Project, file: string, root: string) => void): void {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'structure-'));
	try {
		fs.writeFileSync(path.join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { jsx: 'preserve', strict: true, target: 'es2022', module: 'esnext' }, include: ['*'] }));
		for (const [name, text] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true }); fs.writeFileSync(path.join(root, name), text); }
		const file = path.join(root, Object.keys(files)[0]);
		const project = new Project(file, new Map());
		try { action(project, file, root); } finally { project.dispose(); }
	} finally { fs.rmSync(root, { recursive: true, force: true }); }
}

