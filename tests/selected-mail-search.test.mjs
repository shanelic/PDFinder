import test from 'node:test';
import assert from 'node:assert/strict';
import {createSelectedMailSearch,SelectedMailSearchError} from '../src/selected-mail-search.mjs';
import {DocumentSearchError} from '../src/bounded-document-search.mjs';
import {createTextPdf} from './helpers/synthetic-text-pdf.mjs';
import {makeSyntheticProviderResponse} from './helpers/synthetic-provider-response.mjs';
import {fixedFixtures} from '../src/fixed-fixtures.mjs';
import {loadParser} from '../src/lazy-loader.mjs';
function setup(provider,{bytes=createTextPdf(['First PDF','Other text','Last PDF']),profile=null,...overrides}={}){
  const f=makeSyntheticProviderResponse(provider,bytes,{profile});let calls=0,reads=0,loads=0,resolves=0,plans=[];
  const bridge=createSelectedMailSearch({...f,invoke:async(plan,context)=>{calls++;plans.push(plan);assert.deepEqual(context.connection,f.connection);return f.response;},
    readOriginal:async(ref,context)=>{reads++;assert.equal(ref.file_name,f.selection.source.filename);assert.equal(context.selection.source.message_id,f.selection.source.message_id);return(async function*(){yield f.bytes;})();},
    loadParser:async()=>{loads++;return loadParser();},resolvePassword:async()=>{resolves++;return 'SYNTHETIC-ONLY-DO-NOT-USE';},...overrides});
  return {...f,bridge,counts:()=>({calls,reads,loads,resolves}),plans};
}
const rejects=(p,code)=>assert.rejects(p,e=>(e instanceof SelectedMailSearchError||e instanceof DocumentSearchError)&&e.code===code&&!e.message.includes('DO-NOT-LEAK'));
for(const provider of ['gmail','icloud'])test(provider+' generated PDF flows from exact read plan to real search and citations',async()=>{
  const oldFetch=globalThis.fetch;let net=0;globalThis.fetch=()=>{net++;throw Error('No network permitted');};
  try{
    const f=setup(provider),r=await f.bridge.search(f.selection);assert.equal(r.status,'matches_found');assert.deepEqual(r.matches.map(m=>m.page),[1,3]);
    assert.deepEqual(r.source,f.selection.source);assert.deepEqual(r.matches[0].source,f.selection.source);assert.equal(r.transport.route,f.route);
    assert.deepEqual(f.counts(),{calls:1,reads:provider==='icloud'?1:0,loads:1,resolves:0});assert.equal(net,0);
    assert.deepEqual(f.plans[0],provider==='gmail'?{name:'mcp__codex_apps__gmail_read_email',arguments:{message_id:f.selection.source.message_id,format:'raw'}}:
      {name:'mcp__codex_apps__icloud_mail_get_message',arguments:{message_id:f.selection.source.message_id,attachment_ids:['1.2']}});
  }finally{globalThis.fetch=oldFetch;}
});
for(const provider of ['gmail','icloud'])test(provider+' first retrieval computes an unpinned hash without inventing prior verification',async()=>{
  let resolved;const f=setup(provider,{profile:'public-profile',resolvePassword:async(profile,source)=>{resolved={...source};return undefined;}});
  // Plain document with null profile needs no resolver; a second call checks
  // the resolver sees the computed content identity after original bytes arrive.
  const expected=f.selection.source.sha256;f.selection.source.sha256=null;f.selection.password_profile=null;
  const r=await f.bridge.search(f.selection);assert.equal(r.sha256,expected);assert.equal(r.source.sha256,expected);
  assert.equal(r.matches[0].source.sha256,expected);assert.equal(r.integrity.comparison,'computed_without_prior_hash');
  assert.equal(f.selection.source.sha256,null);
  f.selection.password_profile='public-profile';await rejects(f.bridge.search(f.selection),'profile_unavailable');assert.equal(resolved.sha256,expected);
});
for(const provider of ['gmail','icloud'])test(provider+' known AES256 supports correct, unavailable and incorrect fake profiles',async()=>{
  const fixture=fixedFixtures.find(f=>f.fixture_id==='AES-256.pdf'),bytes=Uint8Array.from(atob(fixture.data),c=>c.charCodeAt(0));
  const f=setup(provider,{bytes,profile:'public-fixture'});assert.equal((await f.bridge.search(f.selection)).status,'matches_found');
  for(const [password,code] of [[undefined,'profile_unavailable'],['PUBLIC-WRONG','incorrect_password']]){
    const bad=setup(provider,{bytes,profile:'public-fixture',resolvePassword:async()=>password});await rejects(bad.bridge.search(bad.selection),code);
  }
});
for(const provider of ['gmail','icloud'])test(provider+' preserves no-text and page-limit outcomes',async()=>{
  const empty=setup(provider,{bytes:createTextPdf([''])});assert.equal((await empty.bridge.search(empty.selection)).status,'no_extractable_text');
  const over=setup(provider,{bytes:createTextPdf(Array(21).fill('PDF'))});await rejects(over.bridge.search(over.selection),'page_limit');
});
for(const [name,mutate,code] of [
  ['wrong account',f=>f.selection.source.account_ref='other','connection_mismatch'],
  ['invalid query',f=>f.selection.query='','invalid_query'],
  ['invalid profile',f=>f.selection.password_profile='not a profile','invalid_profile'],
  ['over byte limit',f=>f.selection.size_bytes=2097153,'input_too_large'],
  ['extra password field',f=>f.selection.password='DO-NOT-LEAK','invalid_selection'],
  ['unknown iCloud attachment',f=>f.selection.source.attachment_id=null,'invalid_selection']
])test(name+' makes zero tool calls',async()=>{const f=setup('icloud');mutate(f);await rejects(f.bridge.search(f.selection),code);assert.deepEqual(f.counts(),{calls:0,reads:0,loads:0,resolves:0});});
test('Gmail raw refuses opaque attachment ID instead of inventing its mapping',async()=>{
  const f=setup('gmail');f.selection.source.attachment_id='unknown-id';await rejects(f.bridge.search(f.selection),'route_selection_invalid');assert.equal(f.counts().calls,0);
});
test('Gmail raw rejects impossible size before read rather than claiming 2MiB support',async()=>{
  const f=setup('gmail');f.selection.size_bytes=786433;await rejects(f.bridge.search(f.selection),'route_selection_invalid');assert.equal(f.counts().calls,0);
});
for(const provider of ['gmail','icloud'])test(provider+' wrong message response is rejected before original/parsing',async()=>{
  const f=setup(provider);f.response.structuredContent.id='other';await rejects(f.bridge.search(f.selection),'mail_response_rejected');
  assert.deepEqual(f.counts(),{calls:1,reads:0,loads:0,resolves:0});
});
test('iCloud wrong file metadata cannot reach file redemption',async()=>{
  const f=setup('icloud');f.response.structuredContent.attachments[0].filename='wrong.pdf';await rejects(f.bridge.search(f.selection),'mail_response_rejected');assert.equal(f.counts().reads,0);
});
test('Gmail wrong hash is rejected by MIME selector before parser',async()=>{
  const f=setup('gmail');f.selection.source.sha256='0'.repeat(64);await rejects(f.bridge.search(f.selection),'mail_response_rejected');assert.equal(f.counts().loads,0);
});
test('iCloud same-length byte tampering is rejected by document boundary',async()=>{
  const f=setup('icloud');f.bytes[100]^=1;await rejects(f.bridge.search(f.selection),'integrity_failed');assert.equal(f.counts().loads,0);
});
test('structuredContent required, text representations are never decoded as original',async()=>{
  const f=setup('gmail');f.response={content:[{type:'text',text:'DO-NOT-LEAK'}]};
  const b=createSelectedMailSearch({...f,loadParser,resolvePassword:async()=>undefined,invoke:async()=>f.response});
  await rejects(b.search(f.selection),'mail_response_rejected');
});
test('MCP error and structured provider error are rejected without retry',async()=>{
  for(const mutate of [f=>f.response.isError=true,f=>f.response.structuredContent.error='DO-NOT-LEAK']){
    const f=setup('gmail');mutate(f);await rejects(f.bridge.search(f.selection),f.response.isError?'mail_read_failed':'mail_response_rejected');assert.equal(f.counts().calls,1);
  }
});
test('tool and reader exceptions never leak their messages or masquerade as parser errors',async()=>{
  const f=setup('gmail',{invoke:async()=>{throw Object.assign(Error('DO-NOT-LEAK'),{name:'PasswordException',code:2});}});await rejects(f.bridge.search(f.selection),'mail_read_failed');
  const g=setup('icloud',{readOriginal:async()=>{throw Error('DO-NOT-LEAK');}});await rejects(g.bridge.search(g.selection),'attachment_read_failed');
});
test('pre-abort prevents read; abort after tool prevents decoder/redemption',async()=>{
  const a=new AbortController();a.abort();const f=setup('icloud');await rejects(f.bridge.search(f.selection,{signal:a.signal}),'request_cancelled');assert.equal(f.counts().calls,0);
  const b=new AbortController();let reads=0;const g=setup('icloud',{invoke:async()=>{b.abort();return {};},readOriginal:async()=>{reads++;}});
  await rejects(g.bridge.search(g.selection,{signal:b.signal}),'request_cancelled');assert.equal(reads,0);
});
test('busy blocks a second tool call and bridge recovers after failed read',async()=>{
  let enter,release,calls=0;const ready=new Promise(r=>enter=r),gate=new Promise(r=>release=r);
  const f=setup('gmail',{invoke:async()=>{calls++;enter();await gate;throw Error('DO-NOT-LEAK');}});
  const pending=f.bridge.search(f.selection);await ready;await rejects(f.bridge.search(f.selection),'busy');assert.equal(calls,1);release();await rejects(pending,'mail_read_failed');
  await rejects(f.bridge.search(f.selection),'mail_read_failed');assert.equal(calls,2);
});
test('host selection and tool plan are immutable snapshots during async read',async()=>{
  let enter,release,seen;const ready=new Promise(r=>enter=r),gate=new Promise(r=>release=r);
  const f=setup('gmail',{invoke:async(plan,context)=>{seen=context;enter();await gate;return f.response;}}),original={...f.selection.source};
  const pending=f.bridge.search(f.selection);await ready;f.selection.source.message_id='changed';f.selection.query='Other';
  assert.equal(Object.isFrozen(seen.selection),true);assert.equal(Object.isFrozen(seen.selection.source),true);assert.equal(Object.isFrozen(seen.plan.arguments),true);
  release();const r=await pending;assert.deepEqual(r.source,original);assert.deepEqual(r.matches.map(m=>m.quote),['PDF','PDF']);
});
test('mismatched route and missing iCloud reader cannot configure a bridge',()=>{
  const f=setup('icloud');assert.throws(()=>createSelectedMailSearch({...f,route:'gmail_raw',invoke:async()=>{},loadParser,resolvePassword:async()=>undefined}),/Explicit selected-mail/);
  assert.throws(()=>createSelectedMailSearch({...f,invoke:async()=>{},loadParser,resolvePassword:async()=>undefined}),/Explicit selected-mail/);
});
