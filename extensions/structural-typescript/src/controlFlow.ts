/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as ts from 'typescript';
import { Project, nodeAt, resolvedSymbol } from './project';

export interface FlowEdge { readonly target: number; readonly branch?: boolean; readonly exceptional?: boolean }
export interface FlowNode {
	readonly id: number;
	readonly start: number;
	readonly end: number;
	readonly label: string;
	readonly uses: readonly string[];
	readonly writes: readonly string[];
	readonly expression?: ts.Expression;
	readonly condition?: ts.Expression;
	readonly edges: FlowEdge[];
}
export interface FlowFacts {
	readonly reachable: boolean;
	readonly reaching: ReadonlyMap<string, ReadonlySet<number>>;
	readonly liveIn: ReadonlySet<string>;
	readonly liveOut: ReadonlySet<string>;
	readonly values: ReadonlyMap<string, ReadonlySet<string>>;
	readonly possiblyUnassigned: readonly string[];
}
export interface FunctionFlow {
	readonly fileName: string;
	readonly nodes: readonly FlowNode[];
	readonly facts: readonly FlowFacts[];
	readonly variables: ReadonlyMap<string, string>;
	readonly mutations: readonly { start: number; text: string }[];
}
export class UnsupportedFlow extends Error { }
const unknown = '?';
const unassigned = '<unassigned>';
function isAssignment(kind: ts.SyntaxKind): boolean { return kind >= ts.SyntaxKind.FirstAssignment && kind <= ts.SyntaxKind.LastAssignment; }
function equalSet<T>(a: ReadonlySet<T>, b: ReadonlySet<T>): boolean { return a.size === b.size && [...a].every(value => b.has(value)); }
function equalMap<T>(a: ReadonlyMap<string, ReadonlySet<T>>, b: ReadonlyMap<string, ReadonlySet<T>>): boolean { return a.size === b.size && [...a].every(([key, value]) => b.has(key) && equalSet(value, b.get(key)!)); }
function merge<T>(maps: readonly ReadonlyMap<string, ReadonlySet<T>>[]): Map<string, Set<T>> {
	const result = new Map<string, Set<T>>();
	for (const map of maps) { for (const [key, values] of map) { const set = result.get(key) ?? new Set<T>(); for (const value of values) { set.add(value); } result.set(key, set); } }
	return result;
}

/** Intraprocedural CFG. Unsupported control constructs fail explicitly, never flatten silently. */
export function analyzeFunction(project: Project, fileName: string, offset: number): FunctionFlow {
	const source = project.program.getSourceFile(fileName)!;
	let owner = nodeAt(source, offset);
	while (owner.parent && !ts.isFunctionLike(owner)) { owner = owner.parent; }
	const fn = ts.isFunctionDeclaration(owner) || ts.isFunctionExpression(owner) || ts.isArrowFunction(owner) || ts.isMethodDeclaration(owner) || ts.isConstructorDeclaration(owner) || ts.isGetAccessorDeclaration(owner) || ts.isSetAccessorDeclaration(owner) ? owner : undefined;
	if (!fn?.body || !ts.isBlock(fn.body)) { throw new UnsupportedFlow('function'); }
	const body = fn.body;
	const variables = new Map<string, string>();
	const symbols = new Map<ts.Symbol, string>();
	const parameterKeys = new Set<string>();
	const collectBinding = (name: ts.BindingName, parameter: boolean): void => {
		if (!ts.isIdentifier(name)) { throw new UnsupportedFlow('binding'); }
		const symbol = resolvedSymbol(project, name);
		if (!symbol) { throw new UnsupportedFlow('symbol'); }
		const key = `${name.text}@${name.getStart()}`;
		symbols.set(symbol, key); variables.set(key, name.text);
		if (parameter) { parameterKeys.add(key); }
	};
	for (const parameter of fn.parameters) {
		if (parameter.initializer) { throw new UnsupportedFlow('parameter initializer'); }
		collectBinding(parameter.name, true);
	}
	const visit = (node: ts.Node, action: (node: ts.Node) => void): void => {
		if (ts.isFunctionLike(node)) { return; }
		action(node); node.forEachChild(child => visit(child, action));
	};
	visit(body, node => {
		if (ts.isVariableDeclarationList(node) && !(node.flags & (ts.NodeFlags.Let | ts.NodeFlags.Const))) { throw new UnsupportedFlow('var binding'); }
		if (ts.isVariableDeclaration(node)) { collectBinding(node.name, false); }
		if (ts.isTryStatement(node) || ts.isSwitchStatement(node) || ts.isLabeledStatement(node) || ts.isWithStatement(node) || ts.isForInStatement(node) || ts.isForOfStatement(node) || ts.isClassDeclaration(node)) { throw new UnsupportedFlow('control'); }
		if (ts.isCallExpression(node) && node.expression.getText() === 'eval') { throw new UnsupportedFlow('eval'); }
	});
	const checkClosures = (node: ts.Node): void => {
		if (ts.isFunctionLike(node)) { throw new UnsupportedFlow('nested function'); }
		node.forEachChild(checkClosures);
	};
	body.forEachChild(checkClosures);
	const keyOf = (node: ts.Node) => { const symbol = resolvedSymbol(project, node); return symbol ? symbols.get(symbol) : undefined; };
	const reads = (expression: ts.Node | undefined): string[] => {
		const result = new Set<string>();
		if (expression) { visit(expression, child => {
			if (ts.isIdentifier(child) && !(ts.isPropertyAccessExpression(child.parent) && child.parent.name === child) && !(ts.isPropertyAssignment(child.parent) && child.parent.name === child)) { const key = keyOf(child); if (key) { result.add(key); } }
		}); }
		return [...result];
	};
	const nodes: FlowNode[] = [];
	const mutations: { start: number; text: string }[] = [];
	const create = (label: string, syntax?: ts.Node, uses: string[] = [], writes: string[] = [], expression?: ts.Expression, condition?: ts.Expression): number => {
		if (nodes.length >= 300) { throw new UnsupportedFlow('size'); }
		const id = nodes.length;
		nodes.push({ id, label, start: syntax?.getStart() ?? body.getStart(), end: syntax?.end ?? body.end, uses, writes, expression, condition, edges: [] });
		return id;
	};
	const entry = create('entry'), exit = create('exit'), exceptionalExit = create('exceptional exit');
	const connect = (from: readonly number[], to: number, branch?: boolean): void => {
		for (const id of from) {
			const condition = nodes[id].condition;
			if (branch !== undefined && condition && (condition.kind === ts.SyntaxKind.TrueKeyword && !branch || condition.kind === ts.SyntaxKind.FalseKeyword && branch)) { continue; }
			nodes[id].edges.push({ target: to, branch });
		}
	};
	const atomic = (syntax: ts.Node, incoming: number[], expression?: ts.Expression, declaration?: ts.VariableDeclaration): number[] => {
		let uses = reads(expression), writes: string[] = [];
		if (declaration) { const key = keyOf(declaration.name); if (key && expression) { writes = [key]; } }
		else if (expression && ts.isBinaryExpression(expression) && expression.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(expression.left)) {
			const key = keyOf(expression.left); if (key) { writes = [key]; uses = reads(expression.right); expression = expression.right; }
		} else if (expression && ts.isBinaryExpression(expression) && isAssignment(expression.operatorToken.kind) && ts.isIdentifier(expression.left)) {
			const key = keyOf(expression.left); if (key) { writes = [key]; }
		} else if (expression && (ts.isPostfixUnaryExpression(expression) || ts.isPrefixUnaryExpression(expression)) && [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(expression.operator)) {
			const key = keyOf(expression.operand); if (key) { writes = [key]; }
		}
		visit(expression ?? syntax, child => {
			if (ts.isBinaryExpression(child) && isAssignment(child.operatorToken.kind) && (ts.isArrayLiteralExpression(child.left) || ts.isObjectLiteralExpression(child.left))) { throw new UnsupportedFlow('destructuring write'); }
			if (ts.isBinaryExpression(child) && [ts.SyntaxKind.BarBarEqualsToken, ts.SyntaxKind.AmpersandAmpersandEqualsToken, ts.SyntaxKind.QuestionQuestionEqualsToken].includes(child.operatorToken.kind)) { throw new UnsupportedFlow('conditional write'); }
			if (ts.isBinaryExpression(child) && isAssignment(child.operatorToken.kind) || (ts.isPostfixUnaryExpression(child) || ts.isPrefixUnaryExpression(child)) && [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(child.operator)) {
				if (child !== expression) { throw new UnsupportedFlow('nested write'); }
			}
		});
		const id = create(syntax.getText().slice(0, 180), syntax, uses, writes, expression);
		connect(incoming, id);
		// Exceptional edges carry incoming facts: a failed initializer has not assigned its target.
		if (expression) { nodes[id].edges.push({ target: exceptionalExit, exceptional: true }); }
		visit(syntax, child => {
			if (ts.isBinaryExpression(child) && isAssignment(child.operatorToken.kind) && (ts.isPropertyAccessExpression(child.left) || ts.isElementAccessExpression(child.left))) { mutations.push({ start: child.getStart(), text: child.getText() }); }
			if (ts.isDeleteExpression(child) && (ts.isPropertyAccessExpression(child.expression) || ts.isElementAccessExpression(child.expression))) { mutations.push({ start: child.getStart(), text: child.getText() }); }
			if ((ts.isPrefixUnaryExpression(child) || ts.isPostfixUnaryExpression(child)) && [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(child.operator) && (ts.isPropertyAccessExpression(child.operand) || ts.isElementAccessExpression(child.operand))) { mutations.push({ start: child.getStart(), text: child.getText() }); }
			if (ts.isCallExpression(child) && ts.isPropertyAccessExpression(child.expression) && ['push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse', 'set', 'delete', 'clear'].includes(child.expression.name.text)) { mutations.push({ start: child.getStart(), text: child.getText() }); }
		});
		return [id];
	};
	const conditionNode = (expression: ts.Expression | undefined, syntax: ts.Node, incoming: number[]): number => {
		if (expression) { visit(expression, child => { if (ts.isBinaryExpression(child) && isAssignment(child.operatorToken.kind) || ts.isPostfixUnaryExpression(child) || ts.isPrefixUnaryExpression(child) && [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(child.operator)) { throw new UnsupportedFlow('condition write'); } }); }
		const id = create(expression?.getText() ?? 'true', syntax, reads(expression), [], undefined, expression);
		connect(incoming, id);
		if (expression) { nodes[id].edges.push({ target: exceptionalExit, exceptional: true }); }
		return id;
	};
	const declarations = (list: ts.VariableDeclarationList, incoming: number[]): number[] => {
		let tails = incoming;
		for (const declaration of list.declarations) { tails = atomic(declaration, tails, declaration.initializer, declaration); }
		return tails;
	};
	const sequence = (statements: readonly ts.Statement[], incoming: number[], breakTarget?: number, continueTarget?: number): number[] => {
		let tails = incoming;
		for (const statement of statements) { tails = build(statement, tails, breakTarget, continueTarget); }
		return tails;
	};
	const build = (statement: ts.Statement, incoming: number[], breakTarget?: number, continueTarget?: number): number[] => {
		if (ts.isBlock(statement)) { return sequence(statement.statements, incoming, breakTarget, continueTarget); }
		if (ts.isVariableStatement(statement)) { return declarations(statement.declarationList, incoming); }
		if (ts.isIfStatement(statement)) {
			const condition = conditionNode(statement.expression, statement.expression, incoming);
			const yes = create('true branch', statement.expression), no = create('false branch', statement.expression);
			connect([condition], yes, true); connect([condition], no, false);
			return [...build(statement.thenStatement, [yes], breakTarget, continueTarget), ...(statement.elseStatement ? build(statement.elseStatement, [no], breakTarget, continueTarget) : [no])];
		}
		if (ts.isWhileStatement(statement) || ts.isForStatement(statement) || ts.isDoStatement(statement)) {
			let initial = incoming;
			if (ts.isForStatement(statement) && statement.initializer) { initial = ts.isVariableDeclarationList(statement.initializer) ? declarations(statement.initializer, initial) : atomic(statement.initializer, initial, statement.initializer); }
			const test = conditionNode(ts.isForStatement(statement) ? statement.condition : statement.expression, statement, []);
			const after = create('loop exit', statement), start = create('loop body', statement);
			const increment = ts.isForStatement(statement) && statement.incrementor ? atomic(statement.incrementor, [], statement.incrementor)[0] : test;
			if (increment !== test) { connect([increment], test); }
			connect(initial, ts.isDoStatement(statement) ? start : test);
			connect([test], start, true);
			if (!ts.isForStatement(statement) || statement.condition) { connect([test], after, false); }
			connect(build(statement.statement, [start], after, increment), increment);
			return [after];
		}
		if (ts.isBreakStatement(statement) || ts.isContinueStatement(statement)) {
			if (statement.label) { throw new UnsupportedFlow('label'); }
			const target = ts.isBreakStatement(statement) ? breakTarget : continueTarget;
			if (target === undefined) { throw new UnsupportedFlow('jump'); }
			const tails = atomic(statement, incoming); connect(tails, target); return [];
		}
		if (ts.isReturnStatement(statement) || ts.isThrowStatement(statement)) { const tails = atomic(statement, incoming, statement.expression); connect(tails, ts.isThrowStatement(statement) ? exceptionalExit : exit); return []; }
		if (ts.isExpressionStatement(statement)) { return atomic(statement, incoming, statement.expression); }
		if (ts.isEmptyStatement(statement) || ts.isFunctionDeclaration(statement)) { return incoming; }
		throw new UnsupportedFlow('statement');
	};
	connect(sequence(body.statements, [entry]), exit);
	return solve(project, source, nodes, variables, symbols, parameterKeys, mutations);
}

function solve(project: Project, source: ts.SourceFile, nodes: FlowNode[], variables: Map<string, string>, symbols: Map<ts.Symbol, string>, parameters: Set<string>, mutations: { start: number; text: string }[]): FunctionFlow {
	const reachable = new Set<number>([0]);
	for (const id of reachable) { for (const edge of nodes[id].edges) { reachable.add(edge.target); } }
	const reaching = nodes.map(() => new Map<string, Set<number>>());
	const outgoing = nodes.map(() => new Map<string, Set<number>>());
	const values = nodes.map(() => new Map<string, Set<string>>());
	const valueOut = nodes.map(() => new Map<string, Set<string>>());
	const liveIn = nodes.map(() => new Set<string>()), liveOut = nodes.map(() => new Set<string>());
	for (const [symbol, key] of symbols) {
		reaching[0].set(key, new Set([parameters.has(key) ? 0 : -1]));
		const declaration = symbol.valueDeclaration;
		const type = declaration ? project.checker.getTypeOfSymbolAtLocation(symbol, declaration) : undefined;
		const parts = type?.isUnion() ? type.types : type ? [type] : [];
		values[0].set(key, parameters.has(key) ? new Set(parts.map(part => part.flags & ts.TypeFlags.Null ? 'null' : part.flags & ts.TypeFlags.Undefined ? 'undefined' : part.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown) ? unknown : '<non-null>')) : new Set([unassigned]));
	}
	const predecessors = nodes.map(node => nodes.flatMap(candidate => candidate.edges.filter(edge => edge.target === node.id && reachable.has(candidate.id)).map(edge => ({ node: candidate.id, edge }))));
	const evaluate = (expression: ts.Expression | undefined, state: Map<string, Set<string>>): Set<string> => {
		if (!expression) { return new Set([unknown]); }
		if (ts.isNumericLiteral(expression)) { return new Set([expression.text]); }
		if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) { return new Set([JSON.stringify(expression.text)]); }
		if ([ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword, ts.SyntaxKind.NullKeyword].includes(expression.kind)) { return new Set([expression.getText()]); }
		if (ts.isIdentifier(expression)) {
			const symbol = resolvedSymbol(project, expression), key = symbol ? symbols.get(symbol) : undefined;
			return key ? state.get(key) ?? new Set([unknown]) : new Set([expression.text === 'undefined' && project.checker.getTypeAtLocation(expression).flags & ts.TypeFlags.Undefined ? 'undefined' : unknown]);
		}
		if (ts.isParenthesizedExpression(expression)) { return evaluate(expression.expression, state); }
		if (ts.isBinaryExpression(expression)) {
			const left = evaluate(expression.left, state), right = evaluate(expression.right, state), result = new Set<string>();
			for (const a of left) { for (const b of right) {
				if (!/^-?\d+(\.\d+)?$/.test(a) || !/^-?\d+(\.\d+)?$/.test(b)) { return new Set([unknown]); }
				const x = Number(a), y = Number(b);
				const value = expression.operatorToken.kind === ts.SyntaxKind.PlusToken ? x + y : expression.operatorToken.kind === ts.SyntaxKind.MinusToken ? x - y : expression.operatorToken.kind === ts.SyntaxKind.AsteriskToken ? x * y : undefined;
				if (value === undefined || !Number.isFinite(value)) { return new Set([unknown]); } result.add(String(value));
			} }
			return result.size > 8 ? new Set([unknown]) : result;
		}
		return new Set([unknown]);
	};
	let changed = true, passes = 0;
	while (changed) {
		if (++passes > nodes.length * 20 + 20) { throw new UnsupportedFlow('convergence'); }
		changed = false;
		for (const node of nodes) {
			if (!reachable.has(node.id)) { continue; }
			const incoming = node.id === 0 ? reaching[0] : merge(predecessors[node.id].map(({ node: id, edge }) => edge.exceptional ? reaching[id] : outgoing[id]));
			const inputValues = node.id === 0 ? values[0] : merge(predecessors[node.id].map(({ node: id, edge }) => {
				const state = merge([edge.exceptional ? values[id] : valueOut[id]]);
				const condition = nodes[id].condition;
				if (edge.branch !== undefined && condition && ts.isBinaryExpression(condition) && ts.isIdentifier(condition.left) && condition.right.kind === ts.SyntaxKind.NullKeyword && [ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken].includes(condition.operatorToken.kind)) {
					const symbol = resolvedSymbol(project, condition.left), key = symbol ? symbols.get(symbol) : undefined;
					if (key && state.has(key)) {
						const nonNull = edge.branch === (condition.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsToken);
						const refined = new Set([...state.get(key)!].filter(value => nonNull ? !['null', 'undefined'].includes(value) : ['null', 'undefined', unknown].includes(value)));
						if (refined.has(unknown)) { refined.delete(unknown); if (nonNull) { refined.add('<non-null>'); } else { refined.add('null'); refined.add('undefined'); } }
						state.set(key, refined);
					}
				}
				return state;
			}));
			const output = merge([incoming]), outputValues = merge([inputValues]);
			for (const key of node.writes) {
				output.set(key, new Set([node.id]));
				const computed = evaluate(node.expression, inputValues);
				const previous = valueOut[node.id].get(key);
				const widened = new Set([...(previous ?? []), ...computed]);
				outputValues.set(key, widened.has(unknown) || widened.size > 8 ? new Set([unknown]) : widened);
			}
			if (!equalMap(incoming, reaching[node.id]) || !equalMap(output, outgoing[node.id]) || !equalMap(inputValues, values[node.id]) || !equalMap(outputValues, valueOut[node.id])) { changed = true; }
			reaching[node.id] = incoming; outgoing[node.id] = output; values[node.id] = inputValues; valueOut[node.id] = outputValues;
		}
	}
	changed = true;
	while (changed) {
		changed = false;
		for (const node of [...nodes].reverse()) {
			if (!reachable.has(node.id)) { continue; }
			const out = new Set(node.edges.flatMap(edge => [...liveIn[edge.target]]));
			const exceptionalLive = node.edges.filter(edge => edge.exceptional).flatMap(edge => [...liveIn[edge.target]]);
			const input = new Set([...node.uses, ...exceptionalLive, ...[...out].filter(key => !node.writes.includes(key))]);
			if (!equalSet(input, liveIn[node.id]) || !equalSet(out, liveOut[node.id])) { changed = true; }
			liveIn[node.id] = input; liveOut[node.id] = out;
		}
	}
	return { fileName: source.fileName, nodes, variables, mutations, facts: nodes.map(node => ({ reachable: reachable.has(node.id), reaching: reaching[node.id], values: values[node.id], liveIn: liveIn[node.id], liveOut: liveOut[node.id], possiblyUnassigned: node.uses.filter(key => reaching[node.id].get(key)?.has(-1)) })) };
}
