import test from 'node:test';
import assert from 'node:assert/strict';
import {createSyntheticProfileRevisionGuard} from '../src/synthetic-profile-revision-guard.mjs';
import {createSyntheticPasswordProfiles,createInMemorySyntheticProfileStorage,createSyntheticProfileScope,SyntheticProfileError} from '../src/synthetic-password-profiles.mjs';
import {createSyntheticHostQuery} from '../src/synthetic-host-query.mjs';
import {makeSyntheticProviderResponse} from './helpers/synthetic-provider-response.mjs';
import {fixedFixtures} from '../src/fixed-fixtures.mjs';
import {loadParser} from '../src/lazy-loader.mjs';
const ID='synthetic-guard-profile',GOOD='fixture-aes256',BAD='wrong-test-value',VALUE='SYNTHETIC-ONLY-DO-NOT-USE';
const gate=()=>{let release;const promise=new Promise(r=>release=r);return {promise,release};};
const rejects=(p,code)=>assert.rejects(p,e=>e instanceof SyntheticProfileError&&e.code===code&&e.message==='Synthetic profile operation failed'&&!String(e.stack).includes('DO-NOT-LEAK'));
async function setup(provider='gmail'){
 const fixture=fixedFixtures.find(f=>f.fixture_id==='AES-256.pdf');
 const f=makeSyntheticProviderResponse(provider,Uint8Array.from(atob(fixture.data),c=>c.charCodeAt(0)),{filename:fixture.fixture_id,profile:ID});
 const profiles=createSyntheticPasswordProfiles({storage:createInMemorySyntheticProfileStorage()});await profiles.create({profile_id:ID,value_id:GOOD,scopes:[createSyntheticProfileScope(f.connection,f.selection.source)]});
 return {f,profiles,call:guard=>guard(f.connection,ID,f.selection.source)};
}
const replace=(p,revision,value_id=BAD)=>p.replace({profile_id:ID,expected_revision:revision,value_id});
const revoke=p=>p.revoke({profile_id:ID,expected_revision:1});
function delayed(profiles){
 const entered=gate(),resume=gate();let calls=0;
 return {entered,resume,get calls(){return calls;},profiles:{describe:profiles.describe,resolverFor:c=>async(id,s)=>{calls++;const value=await profiles.resolverFor(c)(id,s);entered.release();await resume.promise;return value;}}};
}
test('unchanged revision is reusable within one job and only public values return',async()=>{
 const f=await setup(),guard=createSyntheticProfileRevisionGuard(f);assert.equal(await f.call(guard),VALUE);assert.equal(await f.call(guard),VALUE);
 await replace(f.profiles,1,BAD);const fresh=createSyntheticProfileRevisionGuard(f);assert.equal(await f.call(fresh),'PUBLIC-WRONG-SYNTHETIC-PASSWORD');
});
for(const kind of ['replace','same value','ABA','revoke'])test('delayed resolution rejects '+kind+' and latches without retry',{timeout:5000},async()=>{
 const f=await setup(),d=delayed(f.profiles),guard=createSyntheticProfileRevisionGuard({profiles:d.profiles});const pending=f.call(guard);await d.entered.promise;
 if(kind==='revoke')await revoke(f.profiles);else {await replace(f.profiles,1,kind==='same value'?GOOD:BAD);if(kind==='ABA')await replace(f.profiles,2,GOOD);}
 d.resume.release();const code=kind==='revoke'?'profile_revoked':'revision_conflict';await rejects(pending,code);await rejects(f.call(guard),code);assert.equal(d.calls,1);
});
test('same guard concurrent use rejects both pending and overlapping resolution',{timeout:5000},async()=>{
 const f=await setup(),d=delayed(f.profiles),guard=createSyntheticProfileRevisionGuard({profiles:d.profiles}),pending=f.call(guard);await d.entered.promise;
 await rejects(f.call(guard),'revision_conflict');d.resume.release();await rejects(pending,'revision_conflict');assert.equal(d.calls,1);
});
test('independent guards can resolve concurrently without cross-job pinning',async()=>{
 const f=await setup();assert.deepEqual(await Promise.all([f.call(createSyntheticProfileRevisionGuard(f)),f.call(createSyntheticProfileRevisionGuard(f))]),[VALUE,VALUE]);
});
test('binding rejects another source before metadata or resolver access',async()=>{
 const f=await setup();let reads=0;const guard=createSyntheticProfileRevisionGuard({profiles:{describe:async id=>{reads++;return f.profiles.describe(id);},resolverFor:f.profiles.resolverFor}});
 await f.call(guard);const before=reads;await rejects(guard(f.f.connection,ID,{...f.f.selection.source,message_id:'synthetic-other'}),'scope_denied');assert.equal(reads,before);
});
test('input mutation during metadata await cannot change captured source',{timeout:5000},async()=>{
 const f=await setup(),entered=gate(),resume=gate();let first=true;
 const guard=createSyntheticProfileRevisionGuard({profiles:{describe:async id=>{if(first){first=false;entered.release();await resume.promise;}return f.profiles.describe(id);},resolverFor:f.profiles.resolverFor}});
 const connection={...f.f.connection},source={...f.f.selection.source},pending=guard(connection,ID,source);await entered.promise;connection.connection_ref='synthetic-other';source.message_id='synthetic-other';resume.release();assert.equal(await pending,VALUE);
});
for(const kind of ['invalid','throw','revision drift'])test('metadata '+kind+' fails closed without leaking or retrying',async()=>{
 const f=await setup();let calls=0;const guard=createSyntheticProfileRevisionGuard({profiles:{describe:async id=>{calls++;if(kind==='throw')throw Error('DO-NOT-LEAK');if(kind==='invalid')return {password:'DO-NOT-LEAK'};const m=await f.profiles.describe(id);return calls===2?{...m,revision:m.revision+1}:m;},resolverFor:f.profiles.resolverFor}});
 const code=kind==='throw'?'storage_unavailable':kind==='invalid'?'storage_invalid':'revision_conflict';await rejects(f.call(guard),code);const before=calls;await rejects(f.call(guard),code);assert.equal(calls,before);
});
test('arbitrary resolver value is rejected without logging or exposing it',async()=>{
 const f=await setup(),messages=[],originals={};for(const name of ['log','error','warn','info','debug']){originals[name]=console[name];console[name]=(...args)=>messages.push(args);}
 try{const guard=createSyntheticProfileRevisionGuard({profiles:{describe:f.profiles.describe,resolverFor:()=>async()=> 'DO-NOT-LEAK'}});await rejects(f.call(guard),'storage_invalid');assert.deepEqual(messages,[]);}finally{Object.assign(console,originals);}
});
test('constructor getter failure is redacted',()=>{assert.throws(()=>createSyntheticProfileRevisionGuard({profiles:{get describe(){throw Error('DO-NOT-LEAK');}}}),e=>e.code==='invalid_profile_input'&&!String(e.stack).includes('DO-NOT-LEAK'));});
async function hostCase(provider,guarded,change){
 const x=await setup(provider),{f,profiles}=x,context={},principal='synthetic-principal',ref='synthetic-selection';let reads=0,parsed=false;
 const auth={principal_id:principal,connection_ref:f.connection.connection_ref},grant={principal_id:principal,selection_ref:ref,revision:1,active:true,connection:f.connection,route:f.route,selection:{source:f.selection.source,size_bytes:1825,password_profile:ID}};
 const extract=await loadParser();
 const host=createSyntheticHostQuery({authenticate:async c=>c===context?auth:null,readGrant:async()=>grant,invoke:async()=>{reads++;return f.response;},readOriginal:async()=> (async function*(){yield f.bytes.slice();})(),
 resolvePassword:guarded?createSyntheticProfileRevisionGuard({profiles}):async(c,id,s)=>profiles.resolverFor(c)(id,s),
 loadParser:async()=>async(...args)=>{const output=await extract(...args);parsed=true;if(change==='ABA'){await replace(profiles,1);await replace(profiles,2,GOOD);}else if(change==='revoke')await revoke(profiles);return output;}});
 const result=host.query({selection_ref:ref,query:'PDF'},context);return {result,stats:()=>({reads,parsed}),freshResolve:()=>createSyntheticProfileRevisionGuard({profiles})(f.connection,ID,f.selection.source),describe:()=>profiles.describe(ID)};
}
test('unguarded baseline still returns an ABA result: opt-in behavior is explicit',async()=>{
 const x=await hostCase('gmail',false,'ABA');assert.equal((await x.result).status,'matches_found');assert.deepEqual(x.stats(),{reads:1,parsed:true});
});
for(const provider of ['gmail','icloud'])test(provider+' guarded real PDF.js host rejects ABA after actual parsing',async()=>{
 const x=await hostCase(provider,true,'ABA');await assert.rejects(x.result,e=>e.code==='profile_unavailable'&&!String(e.stack).includes(VALUE));assert.deepEqual(x.stats(),{reads:1,parsed:true});assert.equal((await x.describe()).revision,3);assert.equal(await x.freshResolve(),VALUE);
});
test('guarded host rejects revoke and accepts unchanged parse without false positive',async()=>{
 const revoked=await hostCase('gmail',true,'revoke');await assert.rejects(revoked.result,e=>e.code==='profile_unavailable');assert.equal(revoked.stats().parsed,true);
 const unchanged=await hostCase('icloud',true,'none');const result=await unchanged.result;assert.equal(result.status,'matches_found');assert.equal(result.matches[0].quote,'PDF');assert.equal(result.matches[0].source.provider,'icloud');assert.equal(JSON.stringify(result).includes(VALUE),false);
});
