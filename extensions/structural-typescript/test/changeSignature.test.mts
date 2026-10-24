/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { fixture } from './fixtures.mts';
import { changeSignature, SignatureError, validExpression } from '../out/changeSignature.js';

function rewritten(code: string, changes: readonly { start: number; length: number; text: string }[]): string {
	for (const change of [...changes].sort((a,b)=>b.start-a.start)) { code=code.slice(0,change.start)+change.text+code.slice(change.start+change.length); }
	return code;
}
test('signature adds explicit migration values and updates imported aliases',()=>{
	const code='export function createUser(name:string,age:number){return {name,age};}';
	fixture({'a.ts':code,'b.ts':'import {createUser as create} from "./a"; export const user=create("Alex",25);'},(project,file)=>{
		const result=changeSignature(project,file,code.indexOf('createUser'),[{originalIndex:0,name:'name'},{name:'email',type:'string',migrationValue:'"unknown@example.com"'},{originalIndex:1,name:'age'}]);
		assert.equal(result.callers,1);
		assert.ok(result.changes.some(change=>change.text.includes('"Alex", "unknown@example.com", 25')));
	});
});

test('rename preserves shorthand property keys and updates recursive call arguments',()=>{
	const code='export function f(count:number,label:string):number{const value={count};return count>0?f(count-1,label):value.count;}';
	fixture({'a.ts':code},(project,file)=>{
		const result=changeSignature(project,file,code.indexOf('f('),[{originalIndex:0,name:'remaining'},{originalIndex:1,name:'label'}]);
		const text=rewritten(code,result.changes);
		assert.ok(text.includes('count: remaining'));assert.ok(text.includes('f(remaining-1, label)'));
	});
});

test('reorder preserves direct caller argument correspondence',()=>{
	const code='export function f(name:string,age:number){return name+age;}f("Alex",25);';
	fixture({'a.ts':code},(project,file)=>{
		const result=changeSignature(project,file,code.indexOf('f('),[{originalIndex:1,name:'age'},{originalIndex:0,name:'name'}]);
		assert.ok(rewritten(code,result.changes).includes('f(25, "Alex")'));
	});
});

test('unused parameter removal keeps remaining arguments',()=>{
	const code='export function f(name:string,unused:number){return name;}f("Alex",25);';
	fixture({'a.ts':code},(project,file)=>{
		const result=changeSignature(project,file,code.indexOf('f('),[{originalIndex:0,name:'name'}]);
		assert.ok(rewritten(code,result.changes).includes('f("Alex")'));
	});
});

test('optional and defaulted additions omit absent trailing arguments',()=>{
	const code='export function f(x:number){return x;}f(1);';
	fixture({'a.ts':code},(project,file)=>{
		for(const parameter of [{name:'label',type:'string',optional:true},{name:'label',type:'string',defaultValue:'"default"'}]){
			const result=changeSignature(project,file,code.indexOf('f('),[{originalIndex:0,name:'x'},parameter]);
			assert.ok(result.changes.some(change=>change.text==='1'));
		}
	});
});

test('compatible overload declarations retain distinct parameter types',()=>{
	const code='export function f(x:string):string;export function f(x:number):number;export function f(x:string|number){return x;}f(1);';
	fixture({'a.ts':code},(project,file)=>{
		const result=changeSignature(project,file,code.indexOf('f('),[{originalIndex:0,name:'value'},{name:'label',type:'string',optional:true}]);
		const text=rewritten(code,result.changes);
		assert.ok(text.includes('value: string, label?: string'));assert.ok(text.includes('value: number, label?: string'));
	});
});

test('constructors update resolved new expressions',()=>{
	const code='export class User {constructor(name:string,age:number){console.log(name,age);}}new User("Alex",25);';
	fixture({'a.ts':code},(project,file)=>{
		const result=changeSignature(project,file,code.indexOf('constructor'),[{originalIndex:1,name:'age'},{originalIndex:0,name:'name'}]);
		assert.ok(rewritten(code,result.changes).includes('new User(25, "Alex")'));
	});
});

test('interface method changes update its implementation and direct callers',()=>{
	const code='export interface Service {run(name:string,count:number):string}export class Impl implements Service {run(name:string,count:number){return name+count;}}const s:Service=new Impl();s.run("Alex",2);';
	fixture({'a.ts':code},(project,file)=>{
		const result=changeSignature(project,file,code.indexOf('run('),[{originalIndex:1,name:'count'},{originalIndex:0,name:'name'}]);
		const text=rewritten(code,result.changes);
		assert.equal((text.match(/run\(count: number, name: string\)/g)??[]).length,2);
		assert.ok(text.includes('s.run(2, "Alex")'));
	});
});

for(const [label,code,parameters] of [
	['missing migration','export function f(x:number){return x;}',[{originalIndex:0,name:'x'},{name:'y',type:'number'}]],
	['removed body reference','export function f(x:number){return x;}',[]],
	['side effect reorder','export function f(a:number,b:number){return a+b;}f(Math.random(),Math.random());',[{originalIndex:1,name:'b'},{originalIndex:0,name:'a'}]],
	['side effect removal','export function f(a:number,b:number){return a;}f(1,Math.random());',[{originalIndex:0,name:'a'}]],
	['callback escape','export function f(x:number){return x;}const g=f;g(1);',[{originalIndex:0,name:'x'}]],
	['spread','export function f(x:number){return x;}const xs:[number]=[1];f(...xs);',[{originalIndex:0,name:'x'}]],
	['shadow capture','export function f(x:number){function nested(value:number){return x+value;}return nested(1);}',[{originalIndex:0,name:'value'}]],
	['arguments','export function f(x:number){return arguments[0];}',[{originalIndex:0,name:'value'}]]
] as const){
	test(`signature refuses ${label}`,()=>fixture({'a.ts':code},(project,file)=>assert.throws(()=>changeSignature(project,file,code.indexOf('f('),parameters),SignatureError)));
}

test('expression validation rejects statement injection',()=>{
	assert.equal(validExpression('"explicit value"'),true);assert.equal(validExpression('0); console.log(1); (0'),false);
});

test('signature refuses a method escaping through literal element access',()=>{
	const code='export class S {run(a:string,b:string){return a+b;}}const s=new S();const g=s["run"];g("a","b");';
	fixture({'a.ts':code},(project,file)=>assert.throws(()=>changeSignature(project,file,code.indexOf('run('),[{originalIndex:1,name:'b'},{originalIndex:0,name:'a'}]),SignatureError));
});
