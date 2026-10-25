/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as ts from 'typescript';
import * as path from 'node:path';
import { Project, walk } from './project';

export function canonicalFileName(fileName: string): string {
	const absolute = path.resolve(fileName);
	return ts.sys.useCaseSensitiveFileNames ? absolute : absolute.toLowerCase();
}

/** Shared module graph, including literal CommonJS loads whose member uses may be untyped. */
export function projectModuleGraph(project: Project): {
	readonly files: readonly ts.SourceFile[];
	readonly dependencies: ReadonlyMap<ts.SourceFile, ReadonlySet<ts.SourceFile>>;
	readonly opaqueDependencies: ReadonlyMap<ts.SourceFile, ReadonlySet<ts.SourceFile>>;
} {
	const files = project.program.getSourceFiles().filter(file => !file.isDeclarationFile && !project.program.isSourceFileFromExternalLibrary(file));
	const byName = new Map(files.map(file => [canonicalFileName(file.fileName), file]));
	const host: ts.ModuleResolutionHost = {
		fileExists: name => byName.has(canonicalFileName(name)) || ts.sys.fileExists(name),
		readFile: name => byName.get(canonicalFileName(name))?.text ?? ts.sys.readFile(name),
		directoryExists: ts.sys.directoryExists,
		realpath: ts.sys.realpath
	};
	const dependencies = new Map<ts.SourceFile, Set<ts.SourceFile>>();
	const opaqueDependencies = new Map<ts.SourceFile, Set<ts.SourceFile>>();
	for (const file of files) {
		const imports = new Set<ts.SourceFile>(), opaque = new Set<ts.SourceFile>();
		dependencies.set(file, imports); opaqueDependencies.set(file, opaque);
		walk(file, node => {
			if (!ts.isStringLiteralLike(node)) { return; }
			const requireCall = ts.isCallExpression(node.parent) && node.parent.arguments[0] === node && ts.isIdentifier(node.parent.expression) && node.parent.expression.text === 'require';
			let dependency = project.checker.getSymbolAtLocation(node)?.declarations?.find(ts.isSourceFile);
			if (!dependency && requireCall) {
				const resolved = ts.resolveModuleName(node.text, file.fileName, project.program.getCompilerOptions(), host).resolvedModule;
				dependency = resolved ? byName.get(canonicalFileName(resolved.resolvedFileName)) : undefined;
			}
			if (dependency && byName.has(canonicalFileName(dependency.fileName))) { imports.add(dependency); if (requireCall) { opaque.add(dependency); } }
		});
	}
	return { files, dependencies, opaqueDependencies };
}
