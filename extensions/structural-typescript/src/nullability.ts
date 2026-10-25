/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as ts from 'typescript';
import { Project, nodeAt, resolvedSymbol } from './project';

export interface NullabilityLocation { readonly fileName: string; readonly start: number; readonly length: number; readonly text: string; readonly kind: 'source' | 'branch' | 'return' }
export interface NullabilityFinding { readonly fileName: string; readonly start: number; readonly length: number; readonly message: string; readonly code: number; readonly trace: readonly NullabilityLocation[] }

/** Uses TypeScript's flow-sensitive diagnostics, with bounded, navigable potential value origins. */
export function analyzeNullability(project: Project): NullabilityFinding[] {
	const options = project.program.getCompilerOptions();
	if (!(options.strictNullChecks ?? options.strict)) { throw new Error('strictNullChecks'); }
	const files = project.program.getSourceFiles().filter(file => !file.isDeclarationFile && !project.program.isSourceFileFromExternalLibrary(file));
	const codes = new Set([2531, 2532, 2533, 2721, 2722, 18047, 18048, 18049]);
	return files.flatMap(file => project.program.getSemanticDiagnostics(file).filter(diagnostic => codes.has(diagnostic.code) || [2322, 2345, 18050].includes(diagnostic.code) && /null|undefined/.test(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))).map(diagnostic => {
		const start = diagnostic.start ?? 0;
		let node = nodeAt(file, start);
		while (node.parent && node.end < start + (diagnostic.length ?? 0)) { node = node.parent; }
		const trace: NullabilityLocation[] = [];
		const seen = new Set<ts.Node>();
		const add = (origin: ts.Node, kind: NullabilityLocation['kind']): void => {
			if (seen.has(origin) || trace.length >= 20) { return; }
			seen.add(origin);
			trace.push({ fileName: origin.getSourceFile().fileName, start: origin.getStart(), length: origin.getWidth(), text: origin.getText().slice(0, 180), kind });
			for (let parent = origin.parent; parent && !ts.isSourceFile(parent); parent = parent.parent) {
				if (ts.isIfStatement(parent)) { add(parent.expression, 'branch'); }
			}
		};
		const follow = (expression: ts.Node, depth: number): void => {
			if (depth > 5 || trace.length >= 20) { return; }
			if (ts.isCallExpression(expression)) {
				const declaration = project.checker.getResolvedSignature(expression)?.declaration;
				if (declaration && !declaration.getSourceFile().isDeclarationFile) {
					add(declaration, 'source');
					const body = ts.isFunctionDeclaration(declaration) || ts.isMethodDeclaration(declaration) || ts.isFunctionExpression(declaration) || ts.isArrowFunction(declaration) || ts.isGetAccessorDeclaration(declaration) || ts.isSetAccessorDeclaration(declaration) ? declaration.body : undefined;
					if (body && ts.isBlock(body)) {
						const returns = (child: ts.Node): void => {
							if (ts.isFunctionLike(child)) { return; }
							if (ts.isReturnStatement(child)) { add(child, 'return'); if (child.expression) { follow(child.expression, depth + 1); } }
							child.forEachChild(returns);
						};
						body.forEachChild(returns);
					} else if (body) { add(body, 'return'); follow(body, depth + 1); }
				}
			}
			if (ts.isIdentifier(expression) || ts.isPropertyAccessExpression(expression)) {
				const symbol = resolvedSymbol(project, ts.isPropertyAccessExpression(expression) ? expression.name : expression);
				for (const declaration of symbol?.declarations ?? []) {
					if (declaration.getSourceFile().isDeclarationFile || seen.has(declaration)) { continue; }
					add(declaration, 'source');
					if (ts.isVariableDeclaration(declaration) || ts.isParameter(declaration) || ts.isPropertyDeclaration(declaration) || ts.isBindingElement(declaration)) {
						if (declaration.initializer) { follow(declaration.initializer, depth + 1); }
					}
				}
				// Assignments are potential origins, not a claim that every assignment reaches this use.
				let scope: ts.Node = expression;
				while (scope.parent && !ts.isFunctionLike(scope) && !ts.isSourceFile(scope)) { scope = scope.parent; }
				const assignments = (child: ts.Node): void => {
					if (child !== scope && ts.isFunctionLike(child)) { return; }
					if (ts.isBinaryExpression(child) && child.operatorToken.kind === ts.SyntaxKind.EqualsToken && child.getStart() < expression.getStart() && resolvedSymbol(project, ts.isPropertyAccessExpression(child.left) ? child.left.name : child.left) === symbol && symbol) { add(child, 'source'); follow(child.right, depth + 1); }
					child.forEachChild(assignments);
				};
				assignments(scope);
			}
			if (ts.isConditionalExpression(expression)) { add(expression.condition, 'branch'); follow(expression.whenTrue, depth + 1); follow(expression.whenFalse, depth + 1); }
			if (ts.isParenthesizedExpression(expression) || ts.isAwaitExpression(expression)) { follow(expression.expression, depth + 1); }
		};
		follow(node, 0);
		// Compiler diagnostics often select the receiver's identifier; expand to include its initializer.
		let ancestor: ts.Node | undefined = node.parent;
		while (ancestor && !ts.isSourceFile(ancestor)) {
			if (ts.isIfStatement(ancestor)) { add(ancestor.expression, 'branch'); }
			if (ts.isConditionalExpression(ancestor)) { add(ancestor.condition, 'branch'); }
			ancestor = ancestor.parent;
		}
		return { fileName: file.fileName, start, length: diagnostic.length ?? node.getWidth(), message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'), code: diagnostic.code, trace };
	}));
}
