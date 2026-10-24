/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as ts from 'typescript';

export interface StructureNode {
	readonly label: string;
	readonly kind: 'component' | 'hook' | 'branch' | 'iteration' | 'declaration';
	readonly start: number;
	readonly end: number;
	readonly children: StructureNode[];
}

/** Keeps JSX nesting and expression control flow in the same tree as declarations. */
export function structure(source: ts.SourceFile): StructureNode[] {
	const roots: StructureNode[] = [];
	const visit = (node: ts.Node, parent: StructureNode[]): void => {
		let label: string | undefined;
		let kind: StructureNode['kind'] = 'declaration';
		if (ts.isJsxElement(node)) { label = `<${node.openingElement.tagName.getText(source)}>`; kind = 'component'; }
		else if (ts.isJsxSelfClosingElement(node)) { label = `<${node.tagName.getText(source)} />`; kind = 'component'; }
		else if (ts.isJsxFragment(node)) { label = '<>'; kind = 'component'; }
		else if (ts.isCallExpression(node) && /^(?:React\.)?use[A-Z]/.test(node.expression.getText(source))) { label = node.expression.getText(source); kind = 'hook'; }
		else if (ts.isConditionalExpression(node)) { label = `${node.condition.getText(source)} ? :`; kind = 'branch'; }
		else if (ts.isBinaryExpression(node) && [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(node.operatorToken.kind)) { label = `${node.left.getText(source)} ${node.operatorToken.getText(source)}`; kind = 'branch'; }
		else if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'map') { label = `${node.expression.expression.getText(source)}.map(…)`; kind = 'iteration'; }
		else if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) || ts.isMethodDeclaration(node) || ts.isVariableDeclaration(node)) && node.name) { label = node.name.getText(source); }
		let children = parent;
		if (label) {
			const item: StructureNode = { label, kind, start: node.getStart(source), end: node.end, children: [] };
			parent.push(item);
			children = item.children;
		}
		node.forEachChild(child => visit(child, children));
	};
	source.forEachChild(child => visit(child, roots));
	return roots;
}
