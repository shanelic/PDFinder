import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeIcloudHostHandoff} from '../src/icloud-host-handoff.mjs';
import {createSelectedAttachmentAdapter,planAttachmentRead,makeSyntheticSearchInput,AttachmentBoundaryError} from '../src/provider-attachments.mjs';
import {fixedFixtures} from '../src/fixed-fixtures.mjs';
import {createSyntheticAttachmentApi} from '../src/synthetic-attachment-api.mjs';
import {loadParser} from '../src/lazy-loader.mjs';
const f=fixedFixtures[3];
const source={source_ref:'synthetic-icloud',provider:'icloud',account_ref:'synthetic-account',message_id:'synthetic-message',attachment_id:'synthetic-attachment',filename:f.fixture_id,sha256:f.sha256};
const selection={source,size_bytes:f.bytes,attachment_id_complete:true,filename_unique_in_message:false,read_attachment_supported:null};
const connection={provider:'icloud',account_ref:source.account_ref,connection_ref:'synthetic-connection'};
const context=()=>({connection:structuredClone(connection),selection:structuredClone(selection),plan:structuredClone(planAttachmentRead(selection))});
const receipt=c=>({received_for:c,originals:[{kind:'original_attachment',reference:{opaque:'synthetic-original'},identity:{message_id:source.message_id,attachment_id:source.attachment_id,filename:f.fixture_id,size_bytes:f.bytes},complete:true}]});
const rejects=(c,r)=>assert.throws(()=>decodeIcloudHostHandoff(r,c),e=>e instanceof AttachmentBoundaryError&&e.message==='Selected attachment unavailable');

test('same-invocation iCloud host receipt returns original, not invented echo',()=>{
  const c=context(),r=receipt(c),decoded=decodeIcloudHostHandoff(r,c);
  assert.equal(decoded.kind,'icloud_original_file');assert.equal(decoded.reference,r.originals[0].reference);
  assert.deepEqual(decoded.identity,r.originals[0].identity);assert.equal(decoded.original_truncated,false);
  r.originals[0].identity.message_id='synthetic-mutated';assert.equal(decoded.identity.message_id,source.message_id);
});
test('absent identity echo remains absent',()=>{
  const c=context(),r=receipt(c);r.originals[0].identity={};assert.deepEqual(decodeIcloudHostHandoff(r,c).identity,{});
});
test('two identical-looking invocations cannot exchange their receipts',()=>{
  const first=context(),second=context();assert.deepEqual(first,second);rejects(second,receipt(first));
});
test('receipt cannot use copied context or connection string as invocation identity',()=>{
  const c=context();for(const replacement of [structuredClone(c),'synthetic-connection',null]){const r=receipt(c);r.received_for=replacement;rejects(c,r);}
});
for(const [label,mutate]of [
  ['wrong provider',c=>c.connection.provider='gmail'],
  ['wrong account',c=>c.connection.account_ref='synthetic-other'],
  ['incomplete attachment ID',c=>c.selection.attachment_id_complete=false],
  ['unknown attachment ID',c=>c.selection.source.attachment_id=null],
  ['wrong message plan',c=>c.plan.arguments.message_id='synthetic-other'],
  ['wrong attachment plan',c=>c.plan.arguments.attachment_ids=['synthetic-other']],
  ['batch attachment plan',c=>c.plan.arguments.attachment_ids.push('synthetic-other')],
  ['extra plan scope',c=>c.plan.arguments.extra='all']
])test(label,()=>{const c=context();mutate(c);rejects(c,receipt(c));});
for(const [label,mutate]of [
  ['no file',r=>r.originals=[]],
  ['multiple files',r=>r.originals.push(r.originals[0])],
  ['sparse file list',r=>r.originals=new Array(1)],
  ['preview file',r=>r.originals[0].kind='extracted_preview'],
  ['incomplete original',r=>r.originals[0].complete=false],
  ['empty reference',r=>r.originals[0].reference=''],
  ['wrong echoed message',r=>r.originals[0].identity.message_id='synthetic-other'],
  ['wrong echoed attachment',r=>r.originals[0].identity.attachment_id='synthetic-other'],
  ['wrong echoed filename',r=>r.originals[0].identity.filename='other.pdf'],
  ['wrong echoed bytes',r=>r.originals[0].identity.size_bytes++],
  ['unrecognized echo',r=>r.originals[0].identity.account_ref='synthetic-other']
])test(label,()=>{const c=context(),r=receipt(c);mutate(r);rejects(c,r);});
test('fake iCloud host receipt -> bounded originals -> real AES256 parsing -> source citation',async()=>{
  const ref={opaque:'synthetic-original'};let opens=0;
  const adapter=createSelectedAttachmentAdapter({connection,
    invoke:async(plan,c)=>{assert.deepEqual(plan,planAttachmentRead(selection));const r=receipt(c);r.originals[0].reference=ref;return r;},
    decodeOriginal:decodeIcloudHostHandoff,
    readOriginal:async(reference,c)=>{assert.equal(reference,ref);assert.equal(c.selection.source.attachment_id,source.attachment_id);opens++;return (async function*(){yield Uint8Array.from(atob(f.data),c=>c.charCodeAt(0));})();}
  });
  const original=await adapter.readSelected(selection);assert.equal(opens,1);
  const api=createSyntheticAttachmentApi({sources:[source],loadParser,resolvePassword:async()=> 'SYNTHETIC-ONLY-DO-NOT-USE'});
  const response=await api.fetch(new Request('https://synthetic.invalid/v1/synthetic/search',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(makeSyntheticSearchInput(original,{query:'PDF',password_profile:'synthetic-fixture'}))}));
  assert.equal(response.status,200);const result=await response.json();assert.deepEqual(result.matches[0].source,source);
  assert.equal(result.matches[0].quote,'PDF');assert.equal(result.matches[0].page,1);
});
test('bad iCloud host handoff never reaches file redemption',async()=>{
  let opens=0;const adapter=createSelectedAttachmentAdapter({connection,invoke:async(_p,c)=>receipt(structuredClone(c)),decodeOriginal:decodeIcloudHostHandoff,readOriginal:async()=>{opens++;throw Error('DO-NOT-LEAK');}});
  await assert.rejects(adapter.readSelected(selection),e=>e.code==='identity_mismatch');assert.equal(opens,0);
});
