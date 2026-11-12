import test from 'node:test';
import assert from 'node:assert/strict';
import {fixedFixtures} from '../src/fixed-fixtures.mjs';
import {loadParser} from '../src/lazy-loader.mjs';
import {createSyntheticAttachmentApi} from '../src/synthetic-attachment-api.mjs';
import {planAttachmentRead,createSelectedAttachmentAdapter,makeSyntheticSearchInput,AttachmentBoundaryError} from '../src/provider-attachments.mjs';

const selection=(provider='gmail',fixture=fixedFixtures[3])=>({
  source:{source_ref:`synthetic-${provider}`,provider,account_ref:`synthetic-${provider}-account`,message_id:'synthetic-message',attachment_id:'synthetic-attachment',filename:fixture.fixture_id,sha256:fixture.sha256},
  size_bytes:fixture.bytes,attachment_id_complete:true,filename_unique_in_message:false,read_attachment_supported:provider==='gmail'?true:null
});
const bytesOf=s=>Uint8Array.from(atob(fixedFixtures.find(f=>f.fixture_id===s.source.filename).data),c=>c.charCodeAt(0));
const errorCode=code=>error=>error instanceof AttachmentBoundaryError && error.code===code && error.message==='Selected attachment unavailable';
function harness(s=selection(),overrides={}) {
  const calls=[],ref={opaque:'synthetic-file-reference'};
  const identity={message_id:s.source.message_id,attachment_id:s.attachment_id_complete?s.source.attachment_id:null,filename:s.source.filename,size_bytes:s.size_bytes};
  const connection={provider:s.source.provider,account_ref:s.source.account_ref,connection_ref:'synthetic-connection'};
  const options={connection,
    invoke:async(plan,context)=>{calls.push('invoke');assert.deepEqual(plan,planAttachmentRead(s));assert.deepEqual(context.connection,connection);return {fixtureResponse:'not-a-provider-schema'};},
    decodeOriginal:async(raw,context)=>{calls.push('decode');assert.deepEqual(raw,{fixtureResponse:'not-a-provider-schema'});assert.equal(context.selection.source.message_id,s.source.message_id);return {kind:s.source.provider==='gmail'?'gmail_original_file':'icloud_original_file',reference:ref,identity,original_truncated:false};},
    readOriginal:async(reference)=>{calls.push('read');assert.equal(reference,ref);return (async function*(){const bytes=bytesOf(s);yield bytes.subarray(0,17);yield bytes.subarray(17);})();},...overrides};
  return {adapter:createSelectedAttachmentAdapter(options),calls,ref,identity,options};
}
const req=input=>new Request('https://synthetic.invalid/v1/synthetic/search',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)});

test('Gmail complete ID wins over filename and never sends both',()=>{
  const s=selection();s.filename_unique_in_message=true;
  assert.deepEqual(planAttachmentRead(s),{name:'mcp__codex_apps__gmail_read_attachment',arguments:{message_id:'synthetic-message',attachment_id:'synthetic-attachment'}});
});
test('Gmail unique exact filename is the only allowed incomplete-ID fallback',()=>{
  const s=selection();s.attachment_id_complete=false;s.filename_unique_in_message=true;
  assert.deepEqual(planAttachmentRead(s),{name:'mcp__codex_apps__gmail_read_attachment',arguments:{message_id:'synthetic-message',filename:'AES-256.pdf'}});
  s.filename_unique_in_message=false;assert.throws(()=>planAttachmentRead(s),errorCode('ambiguous_filename'));
});
test('Gmail unsupported attachment never invokes read_attachment',async()=>{
  for(const value of [false,null]) {
    const s=selection();s.read_attachment_supported=value;const h=harness(s);
    await assert.rejects(h.adapter.readSelected(s),errorCode('attachment_read_unsupported'));assert.deepEqual(h.calls,[]);
  }
});
test('iCloud requests exactly one complete selected ID from the same message',()=>{
  const s=selection('icloud');assert.deepEqual(planAttachmentRead(s),{name:'mcp__codex_apps__icloud_mail_get_message',arguments:{message_id:'synthetic-message',attachment_ids:['synthetic-attachment']}});
  s.attachment_id_complete=false;assert.throws(()=>planAttachmentRead(s),errorCode('complete_attachment_id_required'));
  s.attachment_id_complete=true;s.source.attachment_id=null;assert.throws(()=>planAttachmentRead(s),errorCode('complete_attachment_id_required'));
});

for(const provider of ['gmail','icloud']) for(const fixture of fixedFixtures) test(`${provider} selected plan -> mock file -> real parse -> cited search: ${fixture.fixture_id}`,async()=>{
  const s=selection(provider,fixture),h=harness(s);
  const beforeFetch=globalThis.fetch;let network=0;globalThis.fetch=()=>{network++;throw Error('No outbound fetch');};
  try {
    const original=await h.adapter.readSelected(s);assert.deepEqual(h.calls,['invoke','decode','read']);
    assert.deepEqual(original.source,s.source);assert.equal(original.sha256,fixture.sha256);
    const api=createSyntheticAttachmentApi({sources:[s.source],resolvePassword:async()=> 'SYNTHETIC-ONLY-DO-NOT-USE',loadParser});
    const query=fixture.fixture_id.startsWith('chinese')?'雲端':fixture.fixture_id==='fixture-baseline.pdf'?'中文':'PDF';
    const response=await api.fetch(req(makeSyntheticSearchInput(original,{query,password_profile:fixture.encrypted?'synthetic-fixture':null})));
    assert.equal(response.status,200);const result=await response.json();assert.equal(result.status,'matches_found');
    const c=result.matches[0];assert.deepEqual(c.source,s.source);assert.equal(c.sha256,fixture.sha256);assert.equal(c.page,1);
    assert.equal(Array.from(fixture.expectedPages[0].text).slice(c.range.start,c.range.end).join(''),c.quote);assert.equal(network,0);
  } finally {globalThis.fetch=beforeFetch;}
});

test('unique filename transport keeps unknown attachment ID null through citation',async()=>{
  const s=selection();s.attachment_id_complete=false;s.filename_unique_in_message=true;
  const h=harness(s),original=await h.adapter.readSelected(s);assert.equal(original.source.attachment_id,null);
  const api=createSyntheticAttachmentApi({sources:[original.source],resolvePassword:async()=> 'SYNTHETIC-ONLY-DO-NOT-USE',loadParser});
  const response=await api.fetch(req(makeSyntheticSearchInput(original,{query:'PDF',password_profile:'synthetic-fixture'})));
  assert.equal(response.status,200);assert.equal((await response.json()).matches[0].source.attachment_id,null);
});
test('missing echo fields stay absent without invented provider confirmation',async()=>{
  const s=selection();const h=harness(s,{decodeOriginal:async()=>({kind:'gmail_original_file',reference:'synthetic-opaque-file',identity:{},original_truncated:false}),readOriginal:async()=> (async function*(){yield bytesOf(s);})()});
  assert.deepEqual((await h.adapter.readSelected(s)).source,s.source);
});
for(const field of ['message_id','attachment_id','filename','size_bytes']) test(`wrong echoed ${field} rejected before file read`,async()=>{
  const s=selection(),h=harness(s);h.identity[field]=field==='size_bytes'?0:'synthetic-other';
  await assert.rejects(h.adapter.readSelected(s),errorCode('identity_mismatch'));assert.deepEqual(h.calls,['invoke','decode']);
});
test('connection account/provider mismatch fails before any tool call',async()=>{
  for(const field of ['account_ref','provider']) {
    const s=selection(),h=harness(s);s.source[field]=field==='provider'?'icloud':'synthetic-other';
    await assert.rejects(h.adapter.readSelected(s),errorCode('connection_mismatch'));assert.deepEqual(h.calls,[]);
  }
});
test('selection is snapshotted before invocation awaits',async()=>{
  const s=selection();let release,entered;const waiting=new Promise(r=>release=r),started=new Promise(r=>entered=r);
  const h=harness(s,{invoke:async()=>{entered();await waiting;return {fixtureResponse:'not-a-provider-schema'};}});
  const pending=h.adapter.readSelected(s);await started;s.source.message_id='synthetic-changed';release();
  // The test decoder observes its external s as changed, so use an adapter
  // with a decoder that reads only the immutable invocation context below.
  await assert.rejects(pending,errorCode('response_decode_failed'));
  const fresh=selection();const second=harness(fresh,{invoke:async(_p,c)=>{fresh.source.message_id='synthetic-mutated';return c.selection.source.message_id;},decodeOriginal:async(raw,c)=>{assert.equal(raw,'synthetic-message');return {kind:'gmail_original_file',reference:'opaque',identity:{message_id:c.selection.source.message_id},original_truncated:false};},readOriginal:async()=> (async function*(){yield bytesOf(fresh);})()});
  assert.equal((await second.adapter.readSelected(fresh)).source.message_id,'synthetic-message');
});
for(const [label,change,code] of [
  ['preview instead of original',d=>d.kind='extraction_file_uri','invalid_original_payload'],
  ['wrong provider original',d=>d.kind='icloud_original_file','invalid_original_payload'],
  ['truncated original',d=>d.original_truncated=true,'invalid_original_payload'],
  ['empty reference',d=>d.reference='','invalid_file_reference'],
  ['extra identity assertion',d=>d.identity.account_id='untrusted','invalid_identity_echo'],
  ['extra decoded field',d=>d.extra='untrusted','invalid_original_payload']
]) test(label,async()=>{
  const s=selection();let reads=0;const d={kind:'gmail_original_file',reference:'opaque',identity:{},original_truncated:false};change(d);
  const h=harness(s,{decodeOriginal:async()=>d,readOriginal:async()=>{reads++;throw Error('must not read');}});
  await assert.rejects(h.adapter.readSelected(s),errorCode(code));assert.equal(reads,0);
});
for(const [label,make,code] of [
  ['too few bytes',b=>[b.subarray(1)],'attachment_size_mismatch'],
  ['too many bytes',b=>[b,new Uint8Array([1])],'attachment_size_mismatch'],
  ['empty chunk',b=>[new Uint8Array(),b],'invalid_original_chunk'],
  ['non-byte chunk',()=>['DO-NOT-LEAK'],'invalid_original_chunk'],
  ['same-size tamper',b=>{const copy=new Uint8Array(b);copy[0]^=1;return [copy];},'attachment_integrity_failed']
]) test(label,async()=>{
  const s=selection();let closed=false;
  const h=harness(s,{readOriginal:async()=> (async function*(){try {for(const chunk of make(bytesOf(s)))yield chunk;}finally {closed=true;}})()});
  await assert.rejects(h.adapter.readSelected(s),errorCode(code));assert.equal(closed,true);
});
test('transport chunk bytes are copied, not retained as mutable views',async()=>{
  const s=selection(),data=bytesOf(s),original=new Uint8Array(data);
  const h=harness(s,{readOriginal:async()=> (async function*(){yield data;data.fill(0);})()});
  const result=await h.adapter.readSelected(s);assert.deepEqual(result.bytes,original);assert.equal(data.every(b=>b===0),true);
});
test('pre-abort and mid-stream abort return no attachment',async()=>{
  const s=selection(),controller=new AbortController();controller.abort();const h=harness(s);
  await assert.rejects(h.adapter.readSelected(s,{signal:controller.signal}),errorCode('request_cancelled'));assert.deepEqual(h.calls,[]);
  const mid=new AbortController();const second=harness(s,{readOriginal:async(_r,c)=>{assert.equal(c.signal,mid.signal);return (async function*(){yield bytesOf(s).subarray(0,10);mid.abort();yield bytesOf(s).subarray(10);})();}});
  await assert.rejects(second.adapter.readSelected(s,{signal:mid.signal}),errorCode('request_cancelled'));
});
test('upstream failure is sanitized and never switches to whole-message/raw fallback',async()=>{
  for(const [where,code] of [['invoke','tool_read_failed'],['decodeOriginal','response_decode_failed'],['readOriginal','original_read_failed']]) {
    let failures=0;const h=harness(selection(),{[where]:async()=>{failures++;throw Error('DO-NOT-LEAK-PRIVATE-DETAIL');}});
    await assert.rejects(h.adapter.readSelected(selection()),errorCode(code));assert.equal(failures,1);
  }
});
test('even an injected boundary error cannot disclose an arbitrary code',async()=>{
  for(const mutate of [e=>e,e=>{e.code='DO-NOT-LEAK-MUTATED';e.message='DO-NOT-LEAK-MESSAGE';return e;}]) {
    const h=harness(selection(),{decodeOriginal:async()=>{throw mutate(new AttachmentBoundaryError('DO-NOT-LEAK-PRIVATE-DETAIL'));}});
    await assert.rejects(h.adapter.readSelected(selection()),errorCode('boundary_failed'));
  }
  const h=harness(selection(),{decodeOriginal:async()=>{const e=new AttachmentBoundaryError('boundary_failed');Object.defineProperty(e,'code',{get(){throw Error('DO-NOT-LEAK-GETTER');}});throw e;}});
  await assert.rejects(h.adapter.readSelected(selection()),errorCode('response_decode_failed'));
});
test('unknown filename-fallback ID is not silently promoted from an echo',async()=>{
  const s=selection();s.attachment_id_complete=false;s.filename_unique_in_message=true;
  const h=harness(s);h.identity.attachment_id='synthetic-new-complete-id';
  await assert.rejects(h.adapter.readSelected(s),errorCode('identity_mismatch'));assert.deepEqual(h.calls,['invoke','decode']);
});
test('mutation after file transport is rejected again by the extraction API',async()=>{
  const s=selection(),original=await harness(s).adapter.readSelected(s);original.bytes[0]^=1;
  const api=createSyntheticAttachmentApi({sources:[s.source],resolvePassword:async()=>{throw Error('must not resolve');},loadParser:async()=>{throw Error('must not parse');}});
  const r=await api.fetch(req(makeSyntheticSearchInput(original,{query:'PDF',password_profile:'synthetic-fixture'})));
  assert.equal(r.status,422);assert.deepEqual(await r.json(),{error:'attachment_integrity_failed'});
});
test('unconfigured decoder/file redemption cannot silently fetch a URL',()=>{
  const h=harness();assert.throws(()=>createSelectedAttachmentAdapter({...h.options,decodeOriginal:undefined}),/Explicit host/);
  assert.throws(()=>createSelectedAttachmentAdapter({...h.options,readOriginal:undefined}),/Explicit host/);
});
test('unknown fixtures and wrong size fail before invocation',async()=>{
  for(const mutate of [s=>s.source.sha256='0'.repeat(64),s=>s.size_bytes++,s=>s.source.filename='private.pdf']) {
    const s=selection(),h=harness(s);mutate(s);await assert.rejects(h.adapter.readSelected(s),errorCode('fixture_not_allowed'));assert.deepEqual(h.calls,[]);
  }
});
