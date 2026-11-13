import test from 'node:test';
import assert from 'node:assert/strict';
import {createInMemorySyntheticProfileStorage,createSyntheticPasswordProfiles,createSyntheticProfileScope,SyntheticProfileError} from '../src/synthetic-password-profiles.mjs';
import {makeSyntheticProviderResponse} from './helpers/synthetic-provider-response.mjs';
import {createSelectedMailSearch} from '../src/selected-mail-search.mjs';
import {fixedFixtures} from '../src/fixed-fixtures.mjs';
import {loadParser} from '../src/lazy-loader.mjs';
const ID='synthetic-public-profile',GOOD='fixture-aes256',BAD='wrong-test-value',PASSWORD='SYNTHETIC-ONLY-DO-NOT-USE';
const fixture=fixedFixtures.find(f=>f.fixture_id==='AES-256.pdf');
function fixtureFor(provider='gmail'){
 const f=makeSyntheticProviderResponse(provider,Uint8Array.from(atob(fixture.data),c=>c.charCodeAt(0)),{filename:fixture.fixture_id,profile:ID});
 return {...f,scope:createSyntheticProfileScope(f.connection,f.selection.source)};
}
const failure=(p,code)=>assert.rejects(p,e=>e instanceof SyntheticProfileError&&e.code===code&&e.message==='Synthetic profile operation failed'&&!String(e.stack).includes('DO-NOT-LEAK'));
async function ready({storage=createInMemorySyntheticProfileStorage(),provider='gmail'}={}){
 const f=fixtureFor(provider),service=createSyntheticPasswordProfiles({storage});
 await service.create({profile_id:ID,value_id:GOOD,scopes:[f.scope]});
 return {...f,storage,service,resolve:service.resolverFor(f.connection)};
}
function bridge(f,service){return createSelectedMailSearch({...f,loadParser,resolvePassword:service.resolverFor(f.connection),invoke:async()=>f.response,
 readOriginal:async()=> (async function*(){yield f.bytes.slice();})()});}

for(const provider of ['gmail','icloud'])test(provider+' profile reuse, replace, restore and revoke use real AES256 parser',async()=>{
 const f=await ready({provider}),b=bridge(f,f.service);
 for(let n=0;n<2;n++){
  const result=await b.search(f.selection);assert.equal(result.status,'matches_found');assert.equal(result.page_count,1);assert.equal(result.matches[0].quote,'PDF');assert.deepEqual(result.matches[0].source,f.selection.source);
  assert.equal(JSON.stringify(result).includes(PASSWORD),false);
 }
 assert.deepEqual(await f.service.replace({profile_id:ID,expected_revision:1,value_id:BAD}),{profile_id:ID,revision:2,state:'active',scope_count:1});
 await assert.rejects(()=>b.search(f.selection),e=>e.code==='incorrect_password'&&!e.message.includes(BAD));
 await f.service.replace({profile_id:ID,expected_revision:2,value_id:GOOD});assert.equal((await b.search(f.selection)).status,'matches_found');
 await f.service.revoke({profile_id:ID,expected_revision:3});
 await assert.rejects(()=>b.search(f.selection),e=>e.code==='profile_unavailable');
 assert.deepEqual(await f.service.describe(ID),{profile_id:ID,revision:4,state:'revoked',scope_count:1});
});
test('one profile can explicitly bind both synthetic provider scopes',async()=>{
 const g=fixtureFor('gmail'),i=fixtureFor('icloud'),service=createSyntheticPasswordProfiles({storage:createInMemorySyntheticProfileStorage()});
 await service.create({profile_id:ID,value_id:GOOD,scopes:[g.scope,i.scope]});
 for(const f of [g,i])assert.equal(await service.resolverFor(f.connection)(ID,f.selection.source),PASSWORD);
});
test('source_ref is correlation, not an authority match',async()=>{
 const f=await ready();assert.equal(await f.resolve(ID,{...f.selection.source,source_ref:'synthetic-another-operation'}),PASSWORD);
});
test('resolver reads storage for every use without caching a value',async()=>{
 const memory=createInMemorySyntheticProfileStorage();let reads=0;
 const f=await ready({storage:{read:async id=>{reads++;return memory.read(id);},compareAndSwap:memory.compareAndSwap}});
 await f.resolve(ID,f.selection.source);await f.resolve(ID,f.selection.source);assert.equal(reads,2);
 await f.service.revoke({profile_id:ID,expected_revision:1});await failure(f.resolve(ID,f.selection.source),'profile_revoked');assert.equal(reads,4);
});
for(const [field,value]of [['account_ref','synthetic-other-account'],['message_id','synthetic-other-message'],['attachment_id','synthetic-invalid-attachment'],['filename','another.pdf'],['sha256','0'.repeat(64)],['provider','icloud']])
 test('source '+field+' mismatch cannot resolve',async()=>{const f=await ready();await failure(f.resolve(ID,{...f.selection.source,[field]:value}),'scope_denied');});
test('a valid but different iCloud attachment ID is denied',async()=>{const f=await ready({provider:'icloud'});await failure(f.resolve(ID,{...f.selection.source,attachment_id:'1.3'}),'scope_denied');});
test('different trusted host connection cannot resolve',async()=>{
 const f=await ready();await failure(f.service.resolverFor({...f.connection,connection_ref:'synthetic-other-connection'})(ID,f.selection.source),'scope_denied');
});
test('caller cannot mutate captured resolver connection or source during await',async()=>{
 const memory=createInMemorySyntheticProfileStorage();let release;const gate=new Promise(r=>release=r);let block=false;
 const f=await ready({storage:{read:async id=>{if(block)await gate;return memory.read(id);},compareAndSwap:memory.compareAndSwap}});
 const connection={...f.connection},source={...f.selection.source};const resolve=f.service.resolverFor(connection);block=true;
 const pending=resolve(ID,source);connection.connection_ref='synthetic-other';source.message_id='synthetic-other';release();assert.equal(await pending,PASSWORD);
});
test('input scopes are copied and read records cannot mutate store',async()=>{
 const f=fixtureFor(),storage=createInMemorySyntheticProfileStorage(),service=createSyntheticPasswordProfiles({storage}),scope={...f.scope};
 await service.create({profile_id:ID,value_id:GOOD,scopes:[scope]});scope.message_id='synthetic-other';
 const record=await storage.read(ID);record.scopes[0].message_id='synthetic-other';record.value_id=BAD;
 assert.equal(await service.resolverFor(f.connection)(ID,f.selection.source),PASSWORD);
});
for(const [label,mutate]of [
 ['arbitrary password field',v=>v.password='DO-NOT-LEAK'],
 ['arbitrary value string',v=>v.value_id='my-real-password'],
 ['real-looking profile id',v=>v.profile_id='bank-statement'],
 ['empty scopes',v=>v.scopes=[]],
 ['duplicate scopes',v=>v.scopes.push({...v.scopes[0]})],
 ['too many scopes',v=>v.scopes=Array.from({length:9},(_,i)=>({...v.scopes[0],message_id:'synthetic-message-'+i}))],
 ['empty message',v=>v.scopes[0].message_id=''],
 ['unrestricted hash',v=>v.scopes[0].sha256=null],
 ['control character account',v=>v.scopes[0].account_ref='person\n@example.invalid']
])test('create rejects '+label+' before storage',async()=>{
 const f=fixtureFor();let calls=0;const service=createSyntheticPasswordProfiles({storage:{read:async()=>{calls++;return null;},compareAndSwap:async()=>{calls++;return true;}}});
 const input={profile_id:ID,value_id:GOOD,scopes:[{...f.scope}]};mutate(input);await failure(service.create(input),'invalid_profile_input');assert.equal(calls,0);
});
test('replace cannot widen scopes or accept a password field',async()=>{
 const f=await ready();await failure(f.service.replace({profile_id:ID,expected_revision:1,value_id:GOOD,scopes:[f.scope]}),'invalid_profile_input');
 await failure(f.service.replace({profile_id:ID,expected_revision:1,value_id:GOOD,password:'DO-NOT-LEAK'}),'invalid_profile_input');assert.equal((await f.service.describe(ID)).revision,1);
});
test('missing profile does not fall back to public fixture value',async()=>{const f=await ready();await failure(f.resolve('synthetic-never-created',f.selection.source),'profile_missing');});
test('revoked profile IDs cannot be recreated or replaced',async()=>{
 const f=await ready();await f.service.revoke({profile_id:ID,expected_revision:1});
 await failure(f.service.create({profile_id:ID,value_id:GOOD,scopes:[f.scope]}),'revision_conflict');
 await failure(f.service.replace({profile_id:ID,expected_revision:2,value_id:GOOD}),'profile_revoked');
 await failure(f.service.revoke({profile_id:ID,expected_revision:2}),'profile_revoked');
 assert.equal((await f.service.describe(ID)).state,'revoked');
});
test('stale revisions and concurrent changes cannot overwrite a revoke',async()=>{
 const f=await ready();const results=await Promise.allSettled([f.service.revoke({profile_id:ID,expected_revision:1}),f.service.replace({profile_id:ID,expected_revision:1,value_id:BAD})]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal((await f.service.describe(ID)).state,'revoked');
 await failure(f.service.replace({profile_id:ID,expected_revision:1,value_id:GOOD}),'profile_revoked');
});
test('concurrent replacements have exactly one CAS winner',async()=>{
 const f=await ready();const results=await Promise.allSettled([f.service.replace({profile_id:ID,expected_revision:1,value_id:BAD}),f.service.replace({profile_id:ID,expected_revision:1,value_id:GOOD})]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.code,'revision_conflict');
 assert.equal((await f.service.describe(ID)).revision,2);
});
test('storage read failure is fixed and does not leak or retry',async()=>{
 const f=fixtureFor();let calls=0;const service=createSyntheticPasswordProfiles({storage:{read:async()=>{calls++;throw Error('DO-NOT-LEAK');},compareAndSwap:async()=>true}});
 await failure(service.resolverFor(f.connection)(ID,f.selection.source),'storage_unavailable');assert.equal(calls,1);
});
for(const value of [undefined,{password:'DO-NOT-LEAK'},{profile_id:ID,revision:1,state:'active',value_id:'REAL-SECRET',scopes:[]}])test('malformed storage record is rejected '+typeof value,async()=>{
 const f=fixtureFor(),service=createSyntheticPasswordProfiles({storage:{read:async()=>value,compareAndSwap:async()=>true}});
 await failure(service.resolverFor(f.connection)(ID,f.selection.source),'storage_invalid');
});
test('unknown CAS result is not retried or declared committed',async()=>{
 const f=fixtureFor();let calls=0;const service=createSyntheticPasswordProfiles({storage:{read:async()=>null,compareAndSwap:async()=>{calls++;return undefined;}}});
 await failure(service.create({profile_id:ID,value_id:GOOD,scopes:[f.scope]}),'storage_invalid');assert.equal(calls,1);
});
test('write that applies then throws remains unknown until read; never auto retries',async()=>{
 const memory=createInMemorySyntheticProfileStorage();let throwAfter=false,calls=0;
 const f=await ready({storage:{read:memory.read,compareAndSwap:async(...args)=>{calls++;const result=await memory.compareAndSwap(...args);if(throwAfter)throw Error('DO-NOT-LEAK');return result;}}});
 throwAfter=true;await failure(f.service.revoke({profile_id:ID,expected_revision:1}),'storage_unavailable');assert.equal(calls,2);
 assert.equal((await f.service.describe(ID)).state,'revoked');await failure(f.resolve(ID,f.selection.source),'profile_revoked');
});
test('mutations and metadata never expose value or scoped source IDs',async()=>{
 const f=await ready();for(const result of [await f.service.describe(ID),await f.service.replace({profile_id:ID,expected_revision:1,value_id:BAD}),await f.service.revoke({profile_id:ID,expected_revision:2})]){
  assert.deepEqual(Object.keys(result),['profile_id','revision','state','scope_count']);const text=JSON.stringify(result);
  for(const hidden of [PASSWORD,BAD,GOOD,f.scope.message_id,f.scope.account_ref,f.scope.connection_ref])assert.equal(text.includes(hidden),false);
 }
});
test('restart loses state; no persistent storage or cached-password claim',async()=>{
 const f=await ready(),fresh=createSyntheticPasswordProfiles({storage:createInMemorySyntheticProfileStorage()});
 await failure(fresh.resolverFor(f.connection)(ID,f.selection.source),'profile_missing');
});
test('already-resolved in-flight parsing can complete after revoke',async()=>{
 const f=await ready();let parsedPassword,release,started;const gate=new Promise(r=>release=r),start=new Promise(r=>started=r);
 const extract=await loadParser();
 const b=createSelectedMailSearch({...f,resolvePassword:f.resolve,invoke:async()=>f.response,loadParser:async()=>async(...args)=>{parsedPassword=args[1];started();await gate;return extract(...args);}});
 const pending=b.search(f.selection);await start;assert.equal(parsedPassword,PASSWORD);
 await f.service.revoke({profile_id:ID,expected_revision:1});release();assert.equal((await pending).status,'matches_found');
 await failure(f.resolve(ID,f.selection.source),'profile_revoked');
});
for(const value of [new String(GOOD),{toString:()=>GOOD},Symbol(GOOD)])test('non-string value ID rejected on create, replace and storage: '+typeof value,async()=>{
 const f=await ready();await failure(f.service.create({profile_id:'synthetic-other-profile',value_id:value,scopes:[f.scope]}),'invalid_profile_input');
 await failure(f.service.replace({profile_id:ID,expected_revision:1,value_id:value}),'invalid_profile_input');
 const bad=createSyntheticPasswordProfiles({storage:{read:async()=>({profile_id:ID,revision:1,state:'active',value_id:value,scopes:[f.scope]}),compareAndSwap:async()=>true}});
 await failure(bad.resolverFor(f.connection)(ID,f.selection.source),'storage_invalid');
});
test('resolver constructor redacts hostile connection getter',async()=>{
 const f=await ready(),connection={provider:'gmail',account_ref:'synthetic-account',get connection_ref(){throw Error('DO-NOT-LEAK');}};
 assert.throws(()=>f.service.resolverFor(connection),e=>e instanceof SyntheticProfileError&&e.code==='invalid_profile_input'&&!String(e.stack).includes('DO-NOT-LEAK'));
});
test('storage constructor redacts hostile method getter',()=>{
 assert.throws(()=>createSyntheticPasswordProfiles({storage:{get read(){throw Error('DO-NOT-LEAK');},compareAndSwap:async()=>true}}),
  e=>e instanceof SyntheticProfileError&&e.code==='invalid_profile_input'&&!String(e.stack).includes('DO-NOT-LEAK'));
});
for(const kind of ['only-hole','scope-and-hole'])test('sparse scopes rejected in create and storage: '+kind,async()=>{
 const f=await ready(),scopes=kind==='only-hole'?new Array(1):[f.scope,...[]];if(kind==='scope-and-hole')scopes.length=2;
 await failure(f.service.create({profile_id:'synthetic-other-profile',value_id:GOOD,scopes}),'invalid_profile_input');
 const service=createSyntheticPasswordProfiles({storage:{read:async()=>({profile_id:ID,revision:1,state:'active',value_id:GOOD,scopes}),compareAndSwap:async()=>true}});
 await failure(service.resolverFor(f.connection)(ID,f.selection.source),'storage_invalid');
});

test('opaque host and source IDs support both synthetic provider bridges without rewriting identity',async()=>{
 const service=createSyntheticPasswordProfiles({storage:createInMemorySyntheticProfileStorage()});
 const fixtures=['gmail','icloud'].map((provider,i)=>{
  const f=fixtureFor(provider);
  f.connection={provider,account_ref:'fixture@example.invalid',connection_ref:'connection:fake/'+i};
  f.selection={...f.selection,source:{...f.selection.source,account_ref:f.connection.account_ref,message_id:'opaque-message:'+i,source_ref:'request:fake/'+i}};
  f.response.structuredContent.id=f.selection.source.message_id;
  f.scope=createSyntheticProfileScope(f.connection,f.selection.source);return f;
 });
 await service.create({profile_id:ID,value_id:GOOD,scopes:fixtures.map(f=>f.scope)});
 for(const f of fixtures){
  const result=await bridge(f,service).search(f.selection);assert.equal(result.status,'matches_found');assert.deepEqual(result.matches[0].source,f.selection.source);
  await failure(service.resolverFor({...f.connection,connection_ref:'other'})(ID,f.selection.source),'scope_denied');
 }
});
test('storage accessor is snapshotted before validation; cannot flip value to prototype function',async()=>{
 const f=fixtureFor();let reads=0;
 const record={profile_id:ID,revision:1,state:'active',get value_id(){return ++reads===1?GOOD:'toString';},scopes:[f.scope]};
 const service=createSyntheticPasswordProfiles({storage:{read:async()=>record,compareAndSwap:async()=>true}});
 assert.equal(await service.resolverFor(f.connection)(ID,f.selection.source),PASSWORD);assert.equal(reads,1);
 await failure(service.resolverFor(f.connection)(ID,f.selection.source),'storage_invalid');assert.equal(reads,2);
});
for(const bad of ['', 'x'.repeat(513), 'x\u0000y', 'x\u007fy'])test('opaque source and connection refs enforce bridge bounds '+JSON.stringify(bad.slice(0,8)),()=>{
 const f=fixtureFor();
 for(const key of ['account_ref','connection_ref'])assert.throws(()=>createSyntheticProfileScope({...f.connection,[key]:bad},f.selection.source),e=>e.code==='invalid_profile_input');
 for(const key of ['source_ref','message_id'])assert.throws(()=>createSyntheticProfileScope(f.connection,{...f.selection.source,[key]:bad}),e=>e.code==='invalid_profile_input');
});
