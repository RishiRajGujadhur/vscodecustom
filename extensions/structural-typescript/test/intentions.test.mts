/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { fixture } from './fixtures.mts';
import { intentionsAt } from '../out/intentions.js';
import * as ts from 'typescript';
import { runInNewContext } from 'node:vm';

const cases: [string, string, string, string][] = [
	['ifToTernary', 'function f(b:boolean){if(b){return 1;}else{return 2;}}', 'if(b)', '? (1) : (2)'],
	['ternaryToIf', 'function f(b:boolean){return b ? 1 : 2;}', 'return', 'if (b)'],
	['loopToMap', 'function f(){const out:number[]=[]; for(const x of [1,2]){out.push(x*2);} return out;}', 'for(', '[1,2].map'],
	['promiseToAwait', 'async function f(){return Promise.resolve(2).then(x=>x*2);}', 'return', 'await Promise.resolve'],
	['functionToArrow', 'function f(){const g=function(x:number){return x+1;}; return g(1);}', 'function(x', '=>'],
	['extractRepeated', 'function f(x:number){return (x+1)*(x+1);}', 'return', 'const extractedValue'],
	['simplifyBoolean', 'function f(b:boolean){return b === true;}', '===', '(b)'],
	['nullGuard', 'function f(x:{run():void}|null){x.run();}', 'x.run', 'if (x != null)'],
	['guardClause', 'function f(b:boolean){if(b){return 1;}else{return 2;}}', 'if(b)', '\nreturn 2;'],
	['stringTemplate', 'function f(a:string,b:string){return a+b;}', 'a+b', '`${a}${b}`'],
	['preferConst', 'function f(){let x=1;return x;}', 'let', 'const'],
	['objectMethod', 'function f(){const o={run:function(){return 1;}};return o.run();}', 'run:function', 'run()'],
	['optionalAccess', 'function f(x:{name:string}|null){if(x!=null){return x.name;}return undefined;}', 'if(x', 'x?.name']
];
for (const [id, code, cursor, expected] of cases) {
	test(`intention ${id} plans validated syntax edits`, () => fixture({ 'a.ts': code }, (project, file) => {
		const action = intentionsAt(project, file, code.indexOf(cursor)).find(candidate => candidate.rule.id === id);
		assert.ok(action, id);
		const edits = action.rule.getEdits(action.context)!;
		action.rule.validate(action.context, edits);
		assert.ok(edits.some(edit => edit.text.includes(expected)), JSON.stringify(edits));
	}));
}
const rejected: [string, string, string][] = [
	['ifToTernary', 'function f(b:boolean){if(b){console.log(1);return 1;}else{return 2;}}', 'if(b)'],
	['ternaryToIf', 'const x=true?1:2;', '?'],
	['loopToMap', 'function f(xs:number[]){const o:number[]=[];for(const x of xs){o.push(x);}}', 'for('],
	['promiseToAwait', 'function f(){return Promise.resolve(1).then(x=>x+1);}', 'return'],
	['functionToArrow', 'function f(){const g=function(){return this;};return g();}', 'function()'],
	['extractRepeated', 'function f(x:{value:number}){return x.value+x.value;}', 'return'],
	['simplifyBoolean', 'function f(x:unknown){return x===true;}', '==='],
	['nullGuard', 'function f(x:{run():void}){x.run();}', 'x.run'],
	['guardClause', 'function f(b:boolean){if(b){let x=1;return x;}else{return 2;}}', 'if(b)'],
	['stringTemplate', 'function f(a:number,b:number){return a+b;}', 'a+b'],
	['preferConst', 'function f(){let x=1;x++;return x;}', 'let'],
	['objectMethod', 'function f(){const o={run:function(){return this;}};return o.run();}', 'run:function'],
	['optionalAccess', 'function f(x:{name:string}|null){if(x!=null){return x.name;}return "fallback";}', 'if(x']
];
for (const [id, code, cursor] of rejected) {
	test(`intention ${id} refuses unsafe shape`, () => fixture({ 'a.ts': code }, (project, file) => {
		assert.equal(intentionsAt(project, file, code.indexOf(cursor)).some(candidate => candidate.rule.id === id), false);
	}));
}

test('intentions preserve representative branch, loop and expression results', () => {
	for (const [id, code, cursor] of cases.filter(([id]) => ['ifToTernary', 'ternaryToIf', 'loopToMap', 'extractRepeated', 'simplifyBoolean', 'guardClause', 'stringTemplate', 'preferConst', 'objectMethod'].includes(id))) {
		fixture({ 'a.ts': code }, (project, file) => {
			const action = intentionsAt(project, file, code.indexOf(cursor)).find(candidate => candidate.rule.id === id)!;
			let changed = code;
			for (const edit of [...action.rule.getEdits(action.context)!].sort((a, b) => b.start - a.start)) { changed = changed.slice(0, edit.start) + edit.text + changed.slice(edit.start + edit.length); }
			const execute = (text: string) => runInNewContext(ts.transpileModule(text + '\nJSON.stringify([f(true, "a"), f(false, "b")]);', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText);
			assert.equal(execute(changed), execute(code), id);
		});
	}
});
