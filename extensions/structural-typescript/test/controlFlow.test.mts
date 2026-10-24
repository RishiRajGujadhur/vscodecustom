/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { fixture } from './fixtures.mts';
import { analyzeFunction, UnsupportedFlow } from '../out/controlFlow.js';

test('reaching definitions and constants join both branches at a use', () => {
	const code='function price(premium:boolean){let discount=0;if(premium){discount=20;}const price=100-discount;return price;}';
	fixture({'a.ts':code}, (project,file) => {
		const flow=analyzeFunction(project,file,code.indexOf('let'));
		const key=[...flow.variables.keys()].find(key=>key.startsWith('discount@'))!;
		const use=flow.nodes.find(node=>node.label.startsWith('price='))!;
		assert.deepEqual([...flow.facts[use.id].values.get(key)!].sort(),['0','20']);
		assert.equal(flow.facts[use.id].reaching.get(key)!.size,2);
		assert.ok(flow.facts[use.id].liveIn.has(key));
	});
});

test('loop back edges preserve initialization and later assignments', () => {
	const code='function f(flag:boolean){let x=0;while(flag){x=2;if(flag){break;}}return x;}';
	fixture({'a.ts':code},(project,file)=>{
		const flow=analyzeFunction(project,file,code.indexOf('let'));
		const key=[...flow.variables.keys()].find(key=>key.startsWith('x@'))!;
		const use=flow.nodes.find(node=>node.label==='return x;')!;
		assert.equal(flow.facts[use.id].reaching.get(key)!.size,2);
		assert.deepEqual(flow.facts[use.id].possiblyUnassigned,[]);
	});
});

test('definite assignment, liveness and unreachable statements are explicit',()=>{
	const code='function f(flag:boolean){let x:number;if(flag){x=2;}return x;x=9;}';
	fixture({'a.ts':code},(project,file)=>{
		const flow=analyzeFunction(project,file,code.indexOf('let'));
		const use=flow.nodes.find(node=>node.label==='return x;')!;
		assert.equal(flow.facts[use.id].possiblyUnassigned.length,1);
		assert.equal(flow.facts[flow.nodes.find(node=>node.label==='x=9;')!.id].reachable,false);
		assert.equal(flow.facts[use.id].liveOut.size,0);
	});
});

test('for, do/while, continue and widening reach a fixed point',()=>{
	const code='function f(flag:boolean){let x=0;for(let i=0;i<3;i++){if(flag){continue;}x=x+1;}do{x=2;}while(flag);return x;}';
	fixture({'a.ts':code},(project,file)=>{
		const flow=analyzeFunction(project,file,code.indexOf('let'));
		const key=[...flow.variables.keys()].find(key=>key.startsWith('x@'))!;
		const use=flow.nodes.find(node=>node.label==='return x;')!;
		assert.deepEqual([...flow.facts[use.id].values.get(key)!],['2']);
	});
});

test('null checks refine branch values and mutation sites are retained',()=>{
	const code='function f(x:{value:number}|null){if(x!=null){x.value=2;return x.value;}throw 1;}';
	fixture({'a.ts':code},(project,file)=>{
		const flow=analyzeFunction(project,file,code.indexOf('if'));
		const key=[...flow.variables.keys()].find(key=>key.startsWith('x@'))!;
		const use=flow.nodes.find(node=>node.label==='return x.value;')!;
		assert.equal(flow.facts[use.id].values.get(key)!.has('null'),false);
		assert.equal(flow.mutations.length,1);
		assert.ok(flow.nodes.some(node=>node.edges.some(edge=>edge.exceptional)));
	});
});

test('constant false branches do not create reaching definitions',()=>{
	const code='function f(){let x=1;if(false){x=2;}return x;}';
	fixture({'a.ts':code},(project,file)=>{
		const flow=analyzeFunction(project,file,code.indexOf('let'));
		const key=[...flow.variables.keys()].find(key=>key.startsWith('x@'))!;
		const use=flow.nodes.find(node=>node.label==='return x;')!;
		assert.deepEqual([...flow.facts[use.id].values.get(key)!],['1']);
	});
});
for(const body of ['try{return 1;}finally{}','switch(x){case 1:return 1;}','const {a}=x;return a;','const g=()=>x;return g();','if((x=1)){return x;}']){
	test(`unsupported flow refuses ${body.slice(0,20)}`,()=>{
		const code=`function f(x:any){${body}}`;
		fixture({'a.ts':code},(project,file)=>assert.throws(()=>analyzeFunction(project,file,code.indexOf(body)),UnsupportedFlow));
	});
}
