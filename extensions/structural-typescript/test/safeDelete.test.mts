/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { fixture } from './fixtures.mts';
import { safeDelete, safeDeleteFile } from '../out/safeDelete.js';
import { projectSnapshot, sameSnapshot } from '../out/snapshot.js';
import { Project } from '../out/project.js';

test('safe delete removes an unused local symbol without matching shadowed names',()=>{
	const code='export {}; function scope(){const unused=1;function nested(){const unused=2;return unused;}return nested();}';
	fixture({'a.ts':code},(project,file)=>{
		const plan=safeDelete(project,file,code.indexOf('unused'));
		assert.deepEqual(plan.risks,[]);assert.deepEqual(plan.usages,[]);
		assert.equal(plan.changes.length,1);assert.equal(plan.changes[0].text,'');
	});
});

test('safe delete blocks callers through aliases and re-exports',()=>{
	const code='export function calculateTax(){return 1;}';
	fixture({'a.ts':code,'b.ts':'export {calculateTax as tax} from "./a";','c.ts':'import {tax} from "./b"; tax();'},(project,file)=>{
		const plan=safeDelete(project,file,code.indexOf('calculateTax'));
		assert.ok(plan.usages.some(usage=>usage.kind==='blocking'));
		assert.ok(plan.risks.includes('external'));
	});
});

test('unused imports are removable and type-only imports have no runtime replacement',()=>{
	const code='export interface Unused {name:string}';
	fixture({'a.ts':code,'b.ts':'import type {Unused} from "./a"; export {};'},(project,file)=>{
		const plan=safeDelete(project,file,code.indexOf('Unused'));
		assert.ok(plan.usages.some(usage=>usage.kind==='removable'));
		assert.ok(plan.changes.some(change=>change.fileName.endsWith('b.ts')&&change.text===''));
	});
});

test('deleting an import binding keeps its definition and other business logic',()=>{
	const code='import {foo as local} from "./b"; export {};';
	fixture({'a.ts':code,'b.ts':'export function foo(){return 1;}'},(project,file)=>{
		const plan=safeDelete(project,file,code.indexOf('local'));
		assert.ok(plan.changes.every(change=>change.fileName.endsWith('a.ts')));
		assert.equal(plan.usages.length,0);
	});
});

test('initializer effects and reflective references are reported rather than erased',()=>{
	const code='export {}; const unused=console.log(1);const holder:any={};holder[Math.random()]=2;';
	fixture({'a.ts':code},(project,file)=>{
		const plan=safeDelete(project,file,code.indexOf('unused'));
		assert.ok(plan.risks.includes('sideEffects'));assert.ok(plan.risks.includes('dynamic'));
	});
});

test('file deletion detects dynamic imports, require and triple-slash references',()=>{
	fixture({'a.ts':'export const n=1;','b.ts':'const a=import("./a"); const b=require("./a");'},(project,file)=>{
		const plan=safeDeleteFile(project,file);
		assert.ok(plan.usages.length>=2);assert.deepEqual(plan.risks,['external']);
	});
});

test('overload declarations are deleted together only when no callers exist',()=>{
	const code='export {};function unused(x:string):string;function unused(x:number):number;function unused(x:string|number){return x;}';
	fixture({'a.ts':code},(project,file)=>{
		const plan=safeDelete(project,file,code.indexOf('unused'));
		assert.equal(plan.changes.length,3);assert.equal(plan.usages.length,0);
	});
});

test('member uses in inheritance block deleting the base declaration',()=>{
	const code='export {};class Base {method(){return 1;}}class Child extends Base {run(){return this.method();}}';
	fixture({'a.ts':code},(project,file)=>{
		const plan=safeDelete(project,file,code.indexOf('method'));
		assert.ok(plan.usages.some(usage=>usage.kind==='blocking'));assert.ok(plan.risks.includes('dynamic'));
	});
});

test('verbatim imports preserve module evaluation when the last unused binding is removed',()=>{
	const code='import {foo} from "./b"; export {};';
	fixture({'a.ts':code,'b.ts':'export const foo=1;','tsconfig.json':JSON.stringify({compilerOptions:{target:'es2022',module:'esnext',verbatimModuleSyntax:true},include:['*.ts']})},(project,file)=>{
		const plan=safeDelete(project,file,code.indexOf('foo'));
		assert.equal(plan.changes[0].text,'import "./b";');
	});
});

test('review snapshots reject changed unsaved callers',()=>{
	fixture({'a.ts':'export function unused(){}','b.ts':'export {};'},(project,file,root)=>{
		const snapshot=projectSnapshot(project);
		const other=new Project(file,new Map([[root+'/b.ts','import {unused} from "./a"; unused();']]));
		try{assert.equal(sameSnapshot(other,snapshot),false);}finally{other.dispose();}
	});
});
