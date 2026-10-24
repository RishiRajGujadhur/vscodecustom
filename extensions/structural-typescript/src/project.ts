/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as ts from 'typescript';
import * as path from 'node:path';

/** A command-scoped compiler project, including unsaved editor buffers. */
export class Project {
	readonly service: ts.LanguageService;
	readonly program: ts.Program;
	readonly checker: ts.TypeChecker;

	constructor(fileName: string, buffers: ReadonlyMap<string, string>) {
		const config = ts.findConfigFile(ts.sys.getCurrentDirectory(), ts.sys.fileExists);
		const nearest = ts.findConfigFile(path.dirname(fileName), ts.sys.fileExists, 'tsconfig.json')
			?? ts.findConfigFile(path.dirname(fileName), ts.sys.fileExists, 'jsconfig.json') ?? config;
		let options: ts.CompilerOptions = { allowJs: true, checkJs: true, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext };
		let files = [fileName];
		if (nearest) {
			const read = ts.readConfigFile(nearest, ts.sys.readFile);
			if (read.error) { throw new Error(ts.flattenDiagnosticMessageText(read.error.messageText, '\n')); }
			const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, path.dirname(nearest));
			options = parsed.options;
			files = [...new Set([...parsed.fileNames, fileName])];
		}
		const normalize = (name: string) => ts.sys.useCaseSensitiveFileNames ? name.replace(/\\/g, '/') : name.replace(/\\/g, '/').toLowerCase();
		const content = new Map([...buffers].map(([name, value]) => [normalize(name), value]));
		const readFile = (name: string) => content.get(normalize(name)) ?? ts.sys.readFile(name);
		const host: ts.LanguageServiceHost = {
			getScriptFileNames: () => files,
			getScriptVersion: () => '0',
			getScriptSnapshot: name => { const text = readFile(name); return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text); },
			getCurrentDirectory: () => nearest ? path.dirname(nearest) : path.dirname(fileName),
			getCompilationSettings: () => options,
			getDefaultLibFileName: opts => ts.getDefaultLibFilePath(opts),
			fileExists: name => content.has(normalize(name)) || ts.sys.fileExists(name),
			readFile,
			readDirectory: ts.sys.readDirectory,
			directoryExists: ts.sys.directoryExists,
			realpath: ts.sys.realpath,
			useCaseSensitiveFileNames: () => ts.sys.useCaseSensitiveFileNames
		};
		this.service = ts.createLanguageService(host);
		this.program = this.service.getProgram()!;
		this.checker = this.program.getTypeChecker();
	}

	dispose(): void { this.service.dispose(); }
}

export function nodeAt(source: ts.SourceFile, offset: number): ts.Node {
	let result: ts.Node = source;
	const visit = (node: ts.Node): void => {
		if (node.getStart(source) <= offset && offset < node.end) { result = node; node.forEachChild(visit); }
	};
	source.forEachChild(visit);
	return result;
}

export function walk(node: ts.Node, visit: (node: ts.Node) => void): void {
	visit(node);
	node.forEachChild(child => walk(child, visit));
}

/** Excludes declaration names, member names, JSX attributes and intrinsic tags. */
export function isReference(node: ts.Identifier): boolean {
	const parent = node.parent;
	if ((ts.isPropertyAccessExpression(parent) && parent.name === node)
		|| (ts.isPropertyAssignment(parent) && parent.name === node)
		|| (ts.isJsxAttribute(parent) && parent.name === node)
		|| (ts.isJsxClosingElement(parent))) { return false; }
	if ((ts.isJsxOpeningElement(parent) || ts.isJsxSelfClosingElement(parent)) && parent.tagName === node && /^[a-z]/.test(node.text)) { return false; }
	return true;
}
