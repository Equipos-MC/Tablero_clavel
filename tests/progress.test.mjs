import {test} from 'node:test';
import assert from 'node:assert/strict';
import {productionProgress,assemblyForQuantity} from '../src/progress.ts';
test('8 barrenas with 15 types require 120 assemblies',()=>{
 const assemblies=Array.from({length:15},()=>({made:4}));
 assert.deepEqual(productionProgress(assemblies,8),{made:60,pending:60,total:120,types:15,percent:50});
});
test('extra production of one type cannot compensate another missing type',()=>{
 assert.deepEqual(productionProgress([{made:20},{made:0}],8),{made:8,pending:8,total:16,types:2,percent:50});
 assert.equal(productionProgress([{made:8},{made:8}],8).percent,100);
});
test('no quantity or no assemblies does not report completion',()=>{
 assert.equal(productionProgress([{made:100}]).percent,0);
 assert.equal(productionProgress([],8).percent,0);
});
test('rows use OT target without changing Excel data',()=>{
 const original={made:3,target:120,pending:117};
 assert.deepEqual(assemblyForQuantity(original,8),{made:3,target:8,pending:5});
 assert.equal(original.target,120);
 assert.deepEqual(assemblyForQuantity(original),original);
});
