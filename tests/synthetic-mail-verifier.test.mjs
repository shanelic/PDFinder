import test from 'node:test';
import assert from 'node:assert/strict';
import {createSyntheticMailVerifier,SyntheticMailVerificationError} from '../src/synthetic-mail-verifier.mjs';
import {createSyntheticMailFixture} from '../src/synthetic-mail-fixture.mjs';
import {fixedFixtures} from '../src/fixed-fixtures.mjs';
import {loadParser} from '../src/lazy-loader.mjs';
const fixture=fixedFixtures.find(f=>f.fixture_id==='AES-256.pdf');
const good=()=>({pages:structuredClone(fixture.expectedPages),text_status:'text_found',coverage:{assessment:'not_a_completeness_proof'}});
const fakeParser=async()=>async()=>good();
async function setup(provider,options={}) {
  const mail=await createSyntheticMailFixture();
  const source={source_ref:'host-selected-fixture',provider,account_ref:'opaque-test-account',message_id:'opaque-message-'+provider,
    attachment_id:provider==='gmail'?null:'1.2',filename:fixture.fixture_id,sha256:fixture.sha256};
  const bytes=Uint8Array.from(atob(fixture.data),c=>c.charCodeAt(0));
  const connection={provider,account_ref:source.account_ref,connection_ref:'opaque-connection'};
  const payload=provider==='gmail'?{id:source.message_id,raw:Buffer.from(mail.emlBytes).toString('base64url')}:{
    id:source.message_id,attachments:[{id:'1.2',filename:source.filename,size:bytes.length,mime_type:'application/pdf',is_inline:false,file:{
      file_name:source.filename,mime_type:'application/pdf',file_id:'file_00000000000000000000000000000001',
      download_url:'https://sdmntprsynthetic.oaiusercontent.com/files/00000000-0000-0000-0000-000000000001/raw?synthetic=not-a-token'
    }}]};
  let reads=0,loads=0;
  const readOriginal=async(reference,context)=>{
    reads++;assert.equal(reference.file_name,fixture.fixture_id);assert.equal(context.selection.source.message_id,source.message_id);
    return(async function*(){yield bytes.subarray(0,300);yield bytes.subarray(300);})();
  };
  const verifier=createSyntheticMailVerifier({connection,readOriginal,loadParser:async()=>{loads++;return fakeParser();},...options});
  return {source,payload,bytes,connection,verifier,counts:()=>({reads,loads})};
}
const rejects=(promise,code)=>assert.rejects(promise,e=>e instanceof SyntheticMailVerificationError&&e.code===code&&e.message==='Known synthetic mail verification failed');

test('both observed shapes reach real AES256 parsing and equal page/range/quote',async()=>{
  const originalFetch=globalThis.fetch;let calls=0;globalThis.fetch=()=>{calls++;throw Error('No network allowed');};
  try{
    const results=[];
    for(const provider of ['gmail','icloud']){
      const s=await setup(provider,{loadParser}),r=await s.verifier.verify(s);results.push(r);
      assert.deepEqual(r.source,s.source);assert.deepEqual(r.matches[0].source,s.source);
      assert.equal(r.matches[0].quote,'PDF');assert.equal(r.matches[0].page,1);
      assert.equal(r.summary.match_count,1);assert.equal(r.sha256,fixture.sha256);
      assert.equal(JSON.stringify(r.summary).includes('opaque-'),false);assert.equal(JSON.stringify(r.summary).includes('download_url'),false);
    }
    const comparable=r=>r.matches.map(({source,...match})=>match);
    assert.deepEqual(comparable(results[0]),comparable(results[1]));assert.equal(calls,0);
    assert.equal(results[0].source.attachment_id,null);assert.equal(results[1].source.attachment_id,'1.2');
  }finally{globalThis.fetch=originalFetch;}
});
test('repeat verification is reusable with no persisted password input',async()=>{
  const s=await setup('gmail');assert.deepEqual(await s.verifier.verify(s),await s.verifier.verify(s));assert.equal(s.counts().loads,2);
});
for(const [name,change,code] of [
  ['wrong account',s=>s.source.account_ref='different-account','connection_mismatch'],
  ['wrong provider',s=>s.source.provider='icloud','connection_mismatch'],
  ['unknown fixture',s=>s.source.filename='private.pdf','invalid_selection'],
  ['wrong hash',s=>s.source.sha256='0'.repeat(64),'invalid_selection'],
  ['invented Gmail attachment ID',s=>s.source.attachment_id='invented','invalid_selection'],
  ['extra source key',s=>s.source.password='DO-NOT-LEAK','invalid_selection'],
  ['wrong Gmail message',s=>s.payload.id='different-message','gmail_original_failed'],
  ['invalid raw encoding',s=>s.payload.raw='not a raw message','gmail_original_failed']
])test(name,async()=>{const s=await setup('gmail');change(s);await rejects(s.verifier.verify(s),code);assert.equal(s.counts().loads,0);});
for(const [name,change] of [
  ['wrong iCloud message',s=>s.payload.id='wrong'],
  ['wrong iCloud attachment',s=>s.payload.attachments[0].id='wrong'],
  ['no original reference',s=>s.payload.attachments[0].file=null],
  ['unapproved original URL',s=>s.payload.attachments[0].file.download_url='https://example.invalid/secret'],
  ['altered PDF bytes',s=>s.bytes[100]^=1],
  ['truncated PDF metadata',s=>s.payload.attachments[0].size--]
])test(name,async()=>{const s=await setup('icloud');change(s);await rejects(s.verifier.verify(s),'icloud_original_failed');assert.equal(s.counts().loads,0);});
test('missing iCloud opaque ID is rejected',async()=>{const s=await setup('icloud');s.source.attachment_id=null;await rejects(s.verifier.verify(s),'invalid_selection');assert.deepEqual(s.counts(),{reads:0,loads:0});});
test('read failures do not expose signed URLs or callback details',async()=>{
  const s=await setup('icloud',{readOriginal:async()=>{throw Error('DO-NOT-LEAK https://example.invalid/?token=private');}});
  await rejects(s.verifier.verify(s),'icloud_original_failed');
});
test('parser failure is sanitized and owned bytes are cleared',async()=>{
  let seen;const s=await setup('gmail',{loadParser:async()=>async bytes=>{seen=bytes;throw Error('DO-NOT-LEAK');}});
  await rejects(s.verifier.verify(s),'parser_failed');assert.equal(seen.every(x=>x===0),true);
});
test('detached parser input fails with a sanitized cleanup error',async()=>{
  let transferred;
  const s=await setup('gmail',{loadParser:async()=>async bytes=>{transferred=structuredClone(bytes,{transfer:[bytes.buffer]});return good();}});
  await rejects(s.verifier.verify(s),'buffer_cleanup_failed');assert.equal(transferred.length,fixture.bytes);transferred.fill(0);
});
test('modified fill method cannot inject a cleanup error or bypass clearing',async()=>{
  let seen;
  const s=await setup('gmail',{loadParser:async()=>async bytes=>{seen=bytes;bytes.fill=()=>{throw Error('DO-NOT-LEAK-CLEANUP');};throw Error('DO-NOT-LEAK-PARSER');}});
  await rejects(s.verifier.verify(s),'parser_failed');assert.equal(seen.every(x=>x===0),true);
});
test('incomplete oracle cannot produce citations',async()=>{
  const s=await setup('gmail',{loadParser:async()=>async()=>({...good(),pages:[{page:1,text:'PDF'}]})});
  await rejects(s.verifier.verify(s),'fixture_text_mismatch');
});
test('hostile exported error code cannot leak through verifier',async()=>{
  const error=new SyntheticMailVerificationError('parser_failed');Object.defineProperty(error,'code',{get(){throw Error('DO-NOT-LEAK');}});
  const s=await setup('gmail',{loadParser:async()=>{throw error;}});await rejects(s.verifier.verify(s),'parser_failed');
});
test('pre-cancelled selection never reads or initializes parser',async()=>{
  const s=await setup('icloud'),a=new AbortController();a.abort();await rejects(s.verifier.verify(s,{signal:a.signal}),'request_cancelled');assert.deepEqual(s.counts(),{reads:0,loads:0});
});
test('cancellation after file handoff prevents parser initialization',async()=>{
  const a=new AbortController();const s=await setup('icloud',{readOriginal:async()=>{a.abort();return(async function*(){yield new Uint8Array();})();}});
  await rejects(s.verifier.verify(s,{signal:a.signal}),'request_cancelled');assert.equal(s.counts().loads,0);
});
test('cancellation during parser settles without returning citations',async()=>{
  const a=new AbortController();let seen;const s=await setup('gmail',{loadParser:async()=>async bytes=>{seen=bytes;a.abort();return good();}});
  await rejects(s.verifier.verify(s,{signal:a.signal}),'request_cancelled');assert.equal(seen.every(x=>x===0),true);
});
test('selected source is snapshotted before async parsing',async()=>{
  let entered,release;const gate=new Promise(r=>release=r),ready=new Promise(r=>entered=r);
  const s=await setup('gmail',{loadParser:async()=>{entered();await gate;return async()=>good();}}),original={...s.source};
  const pending=s.verifier.verify(s);await ready;s.source.message_id='changed';release();
  const r=await pending;assert.deepEqual(r.source,original);assert.deepEqual(r.matches[0].source,original);
});
test('explicit host parser and iCloud reader are mandatory',async()=>{
  const s=await setup('icloud');assert.throws(()=>createSyntheticMailVerifier({connection:s.connection,loadParser}),/Explicit synthetic host/);
  assert.throws(()=>createSyntheticMailVerifier({connection:s.connection,readOriginal:async()=>{}}),/Explicit synthetic host/);
});
