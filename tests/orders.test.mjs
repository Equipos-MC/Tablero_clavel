import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
const source = (await readFile(new URL('../functions/packages/storage/documents/index.js', import.meta.url), 'utf8')).replace(/^import .*;\r?\n/gm, '').replace('export async function main', 'async function main');
function service() {
  const objects = new Map([['grua/old.xlsx', 'excel'], ['carroceria/body.xlsx', 'excel']]);
  const commands = Object.fromEntries(['DeleteObjectCommand','GetObjectCommand','ListObjectsV2Command','PutObjectCommand'].map((name) => [name, class { constructor(input) { this.input = input; this.kind = name; } }]));
  const client = { async send({kind,input}) {
    if (kind === 'ListObjectsV2Command') return { Contents: [...objects.keys()].map((Key) => ({Key})) };
    if (kind === 'GetObjectCommand') return { Body: { transformToString: async () => objects.get(input.Key) } };
    if (kind === 'PutObjectCommand') objects.set(input.Key,input.Body);
    if (kind === 'DeleteObjectCommand') objects.delete(input.Key);
    return {};
  }};
  const context = vm.createContext({ ...commands, Buffer, randomUUID, console, process: {env: {SPACES_REGION:'test',SPACES_BUCKET:'test',SPACES_ACCESS_KEY_ID:'test',SPACES_SECRET_ACCESS_KEY:'test'}}, S3Client: class {constructor(){return client;}}, getSignedUrl: async (_client, command) => 'https://example.test/' + command.input.Key });
  vm.runInContext(source,context);
  return { call: (event={}) => context.main(event), objects };
}
const post = (data) => ({ http:{method:'POST'}, ...data });
test('legacy documents remain assigned to OT-EH-150, including Chasis', async () => {
  const {call}=service(); const result=await call();
  assert.equal(result.statusCode,200);
  assert.equal(result.body.orders[0].name,'OT-EH-150');
  assert.equal(result.body.documents[1].group,'CHASIS');
  assert.ok(result.body.documents.every((doc)=>doc.orderId==='legacy-eh150'));
});
test('create OT with custom tabs, reload, add tab and isolate uploaded documents', async () => {
  const {call,objects}=service();
  const created=await call(post({action:'create-order',name:'OT-EP-256',tabs:['Barrena','Chasis','Grúa','Cocina']}));
  assert.equal(created.statusCode,200); const id=created.body.order.id;
  assert.equal((await call()).body.orders[1].tabs.length,4);
  assert.equal((await call(post({action:'add-tab',orderId:id,tab:'Motor'}))).statusCode,200);
  assert.equal((await call()).body.orders[1].tabs.length,5);
  const ticket=await call(post({action:'prepare-upload',orderId:id,group:'COCINA',fileName:'piezas.xlsx'}));
  assert.equal(ticket.statusCode,200); objects.set(ticket.body.storagePath,'excel');
  const docs=(await call()).body.documents;
  assert.equal(docs.filter((doc)=>doc.orderId===id).length,1);
  assert.equal(docs.find((doc)=>doc.orderId===id).group,'COCINA');
  assert.equal((await call(post({action:'prepare-upload',orderId:id,group:'OTRA',fileName:'piezas.xlsx'}))).statusCode,400);
  assert.equal((await call(post({action:'delete',storagePath:ticket.body.storagePath}))).statusCode,200);
  assert.equal((await call()).body.documents.length,2);
});
test('reject empty names, duplicate orders and duplicate tabs',async()=>{
  const {call}=service();
  for (const data of [
    {action:'create-order',name:' ',tabs:['Grúa']},
    {action:'create-order',name:'Test',tabs:[]},
    {action:'create-order',name:'Test',tabs:['Grúa','grua']},
    {action:'create-order',name:'ot-eh-150',tabs:['Grúa']},
    {action:'add-tab',orderId:'legacy-eh150',tab:'grua'},
  ]) assert.ok((await call(post(data))).statusCode>=400);
});
