import {test} from 'node:test';
import assert from 'node:assert/strict';
import {requestJson} from '../src/request.ts';
test('retries a temporary gateway failure then returns the stored data',async(t)=>{
  t.mock.timers.enable({apis:['setTimeout']});
  let calls=0;
  t.mock.method(globalThis,'fetch',async()=> ++calls === 1 ? new Response('upstream timeout',{status:504}) : Response.json({orders:['OT-EH-150'],documents:24}));
  const result=requestJson('/api',undefined,true);
  await new Promise(setImmediate); t.mock.timers.tick(750);
  assert.equal((await result).documents,24); assert.equal(calls,2);
});
test('does not retry writes or permanent errors',async(t)=>{
  let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;return new Response('Unavailable',{status:503})});
  await assert.rejects(requestJson('/api',{method:'POST'}));assert.equal(calls,1);
  t.mock.method(globalThis,'fetch',async()=>{calls++;return Response.json({error:'Acceso denegado'},{status:403})});
  await assert.rejects(requestJson('/api',undefined,true),/Acceso denegado/);assert.equal(calls,2);
});
test('stops after three read attempts and reports a useful error',async(t)=>{
  t.mock.timers.enable({apis:['setTimeout']});let calls=0;
  t.mock.method(globalThis,'fetch',async()=>{calls++;throw new TypeError('network failed')});
  const rejected=assert.rejects(requestJson('/api',undefined,true),/conexión/);
  await new Promise(setImmediate);t.mock.timers.tick(750);
  await new Promise(setImmediate);t.mock.timers.tick(1500);
  await rejected;assert.equal(calls,3);
});
