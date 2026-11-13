import test from 'node:test';
import assert from 'node:assert/strict';
import {createSyntheticHostQuery} from '../src/synthetic-host-query.mjs';
import {createSyntheticPasswordProfiles,createInMemorySyntheticProfileStorage,createSyntheticProfileScope} from '../src/synthetic-password-profiles.mjs';
import {makeSyntheticProviderResponse} from './helpers/synthetic-provider-response.mjs';
import {fixedFixtures} from '../src/fixed-fixtures.mjs';
import {loadParser} from '../src/lazy-loader.mjs';
const profile='synthetic-profile',principal='synthetic-principal',ref='synthetic-selection';
async function setup(provider='gmail',overrides={}){
 const fixture=fixedFixtures.find(f=>f.fixture_id==='AES-256.pdf'),f=makeSyntheticProviderResponse(provider,Uint8Array.from(atob(fixture.data),c=>c.charCodeAt(0)),{filename:fixture.fixture_id,profile});
 const service=createSyntheticPasswordProfiles({storage:createInMemorySyntheticProfileStorage()});await service.create({profile_id:profile,value_id:'fixture-aes256',scopes:[createSyntheticProfileScope(f.connection,f.selection.source)]});
 const grant={principal_id:principal,selection_ref:ref,revision:1,active:true,connection:f.connection,route:f.route,selection:{source:f.selection.source,size_bytes:f.selection.size_bytes,password_profile:profile}};
 const state={reads:0,originals:0,auth:{principal_id:principal,connection_ref:f.connection.connection_ref},grant};const context=Object.freeze({hostSession:Symbol('fake host session')});
 const config={authenticate:async ctx=>ctx===context?state.auth:null,readGrant:async(p,r)=>p===principal&&r===ref?state.grant:null,
 invoke:async()=>{state.reads++;return f.response;},readOriginal:async()=>{state.originals++;return (async function*(){yield f.bytes.slice();})();},loadParser,
 resolvePassword:async(connection,id,source)=>service.resolverFor(connection)(id,source),...overrides};
 return {f,service,state,context,config,host:createSyntheticHostQuery(config),request:{selection_ref:ref,query:'PDF'}};
}
const fails=(promise,code)=>assert.rejects(promise,e=>e.code===code&&!String(e.stack).includes('DO-NOT-LEAK'));
for(const provider of ['gmail','icloud'])test(provider+' untrusted query uses host grant/profile and exact citations',async()=>{
 const f=await setup(provider),result=await f.host.query(f.request,f.context);assert.equal(result.status,'matches_found');assert.deepEqual(result.matches[0].source,f.f.selection.source);assert.equal(result.matches[0].quote,'PDF');assert.equal(f.state.reads,1);assert.equal(f.state.originals,provider==='icloud'?1:0);assert.ok(!JSON.stringify(result).includes('DO-NOT-USE'));
});
for(const key of ['account_ref','provider','message_id','password','authenticated','principal_id','url'])test('request rejects caller '+key+' before reads',async()=>{const f=await setup();await fails(f.host.query({...f.request,[key]:'DO-NOT-LEAK'},f.context),'invalid_request');assert.equal(f.state.reads,0);});
for(const value of [null,{},'authenticated',{principal_id:principal,connection_ref:'synthetic-other'}])test('missing or mismatched host identity '+JSON.stringify(value),async()=>{const f=await setup();f.state.auth=value;await fails(f.host.query(f.request,f.context),value?.connection_ref?'selection_unavailable':'authentication_failed');assert.equal(f.state.reads,0);});
test('caller supplied fake context is not host authentication',async()=>{const f=await setup();await fails(f.host.query(f.request,{authenticated:true}),'authentication_failed');assert.equal(f.state.reads,0);});
for(const kind of ['unknown','revoked','principal','connection','source','hash','profile'])test('grant '+kind+' fails before read',async()=>{const f=await setup();if(kind==='unknown')f.request.selection_ref='synthetic-unknown';if(kind==='revoked')f.state.grant.active=false;if(kind==='principal')f.state.grant.principal_id='synthetic-other';if(kind==='connection')f.state.grant.connection={...f.state.grant.connection,connection_ref:'synthetic-other'};if(kind==='source')f.state.grant.selection.source={...f.state.grant.selection.source,message_id:'synthetic-other'};if(kind==='hash')f.state.grant.selection.source={...f.state.grant.selection.source,sha256:'0'.repeat(64)};if(kind==='profile')f.state.grant.selection.password_profile='synthetic-other';await assert.rejects(f.host.query(f.request,f.context));assert.equal(f.state.reads,0);});
test('profile revoked before query prevents mail reads',async()=>{const f=await setup();await f.service.revoke({profile_id:profile,expected_revision:1});await fails(f.host.query(f.request,f.context),'profile_unavailable');assert.equal(f.state.reads,0);});
for(const field of ['authenticate','readGrant','resolvePassword'])test(field+' exception is redacted and no reads',async()=>{const f=await setup('gmail',{[field]:async()=>{throw Error('DO-NOT-LEAK');}});await fails(f.host.query(f.request,f.context),{authenticate:'authentication_failed',readGrant:'selection_unavailable',resolvePassword:'profile_unavailable'}[field]);assert.equal(f.state.reads,0);});
test('unknown profile return is rejected without fallback',async()=>{const f=await setup('gmail',{resolvePassword:async()=>undefined});await fails(f.host.query(f.request,f.context),'profile_unavailable');assert.equal(f.state.reads,0);});
test('request is snapshotted before awaited authentication',async()=>{const f=await setup();let release;const gate=new Promise(r=>release=r);const host=createSyntheticHostQuery({...f.config,authenticate:async ctx=>{await gate;return f.config.authenticate(ctx);}});const pending=host.query(f.request,f.context);f.request.query='OTHER';f.request.selection_ref='synthetic-other';release();assert.equal((await pending).matches[0].quote,'PDF');});
test('grant revoked after mail fetch prevents iCloud original read',async()=>{const f=await setup('icloud');const host=createSyntheticHostQuery({...f.config,invoke:async(...args)=>{const response=await f.config.invoke(...args);f.state.grant.active=false;return response;}});await fails(host.query(f.request,f.context),'selection_unavailable');assert.equal(f.state.reads,1);assert.equal(f.state.originals,0);});
test('grant revision drift is rejected before original read',async()=>{const f=await setup('icloud');const host=createSyntheticHostQuery({...f.config,invoke:async(...args)=>{const response=await f.config.invoke(...args);f.state.grant.revision++;return response;}});await fails(host.query(f.request,f.context),'selection_unavailable');assert.equal(f.state.originals,0);});
for(const kind of ['grant','profile','auth'])test('revocation during parsing discards result: '+kind,async()=>{const f=await setup();const parser=await loadParser();let parsed=false;const host=createSyntheticHostQuery({...f.config,loadParser:async()=>async(...args)=>{const result=await parser(...args);parsed=true;if(kind==='grant')f.state.grant.active=false;if(kind==='auth')f.state.auth=null;if(kind==='profile')await f.service.revoke({profile_id:profile,expected_revision:1});return result;}});await fails(host.query(f.request,f.context),{grant:'selection_unavailable',profile:'profile_unavailable',auth:'authentication_failed'}[kind]);assert.equal(parsed,true);});
test('wrong public password retains parser failure without leaking value',async()=>{const f=await setup();await f.service.replace({profile_id:profile,expected_revision:1,value_id:'wrong-test-value'});await fails(f.host.query(f.request,f.context),'incorrect_password');});
test('auth accessor snapshot is validated once per boundary',async()=>{
 const f=await setup();let reads=0;const host=createSyntheticHostQuery({...f.config,authenticate:async()=>({get principal_id(){reads++;return principal;},connection_ref:f.f.connection.connection_ref})});assert.equal((await host.query(f.request,f.context)).status,'matches_found');assert.ok(reads>1);
});
test('grant accessor flip cannot bypass snapshot validation',async()=>{
 const f=await setup();let reads=0;const host=createSyntheticHostQuery({...f.config,readGrant:async()=>({...f.state.grant,get active(){return ++reads===1?true:false;}})});await fails(host.query(f.request,f.context),'selection_unavailable');assert.equal(f.state.reads,0);
});
test('iCloud stream rechecks revocation before accepting chunks',async()=>{
 const f=await setup('icloud');const host=createSyntheticHostQuery({...f.config,readOriginal:async()=> (async function*(){f.state.grant.active=false;yield f.f.bytes.slice();})()});await fails(host.query(f.request,f.context),'selection_unavailable');assert.equal(f.state.reads,1);
});
test('hostile request getter redacted before authentication',async()=>{
 const f=await setup();let calls=0;const host=createSyntheticHostQuery({...f.config,authenticate:async()=>{calls++;return f.state.auth;}});await fails(host.query({selection_ref:ref,get query(){throw Error('DO-NOT-LEAK');}},f.context),'invalid_request');assert.equal(calls,0);
});

for(const field of ['message_id','account_ref','connection_ref'])test('resolver cannot mutate granted '+field+' into unauthorized read',async()=>{
 const f=await setup();const host=createSyntheticHostQuery({...f.config,resolvePassword:async(connection,id,source)=>{
  if(field==='connection_ref')connection.connection_ref='synthetic-other';else source[field]='synthetic-other';
  return f.config.resolvePassword(connection,id,source);
 }});await fails(host.query(f.request,f.context),'profile_unavailable');assert.equal(f.state.reads,0);
});
test('caught resolver mutation cannot change source or connection used by bridge',async()=>{
 const f=await setup();let attempts=0;const host=createSyntheticHostQuery({...f.config,resolvePassword:async(connection,id,source)=>{
  for(const [object,key]of [[source,'message_id'],[source,'account_ref'],[connection,'connection_ref']]){assert.ok(Object.isFrozen(object));try{object[key]='synthetic-other';}catch{attempts++;}}
  assert.equal(id,profile);return f.config.resolvePassword(connection,id,source);
 },invoke:async(plan,context)=>{assert.equal(plan.arguments.message_id,f.f.selection.source.message_id);assert.equal(context.selection.password_profile,profile);return f.config.invoke(plan,context);}});
 assert.equal((await host.query(f.request,f.context)).status,'matches_found');assert.ok(attempts>=3);assert.equal(f.state.reads,1);
});

test('lone surrogate query is rejected before auth or profile resolution',async()=>{
 const f=await setup();let calls=0;const host=createSyntheticHostQuery({...f.config,authenticate:async()=>{calls++;return f.state.auth;},resolvePassword:async()=>{calls++;return 'SYNTHETIC-ONLY-DO-NOT-USE';}});
 await fails(host.query({...f.request,query:'\ud800'},f.context),'invalid_request');assert.equal(calls,0);assert.equal(f.state.reads,0);
});

test('equivalent auth fields reordered across checks are accepted',async()=>{
 const f=await setup();let n=0;const host=createSyntheticHostQuery({...f.config,authenticate:async()=>++n%2?{...f.state.auth}:{connection_ref:f.state.auth.connection_ref,principal_id:f.state.auth.principal_id}});
 assert.equal((await host.query(f.request,f.context)).status,'matches_found');assert.ok(n>1);assert.equal(f.state.reads,1);
});
test('equivalent grant and nested fields reordered across checks are accepted',async()=>{
 const f=await setup();let n=0;const reverse=o=>Object.fromEntries(Object.entries(o).reverse());
 const host=createSyntheticHostQuery({...f.config,readGrant:async()=>{
  const g=structuredClone(f.state.grant);if(++n%2){g.connection=reverse(g.connection);g.selection=reverse({...g.selection,source:reverse(g.selection.source)});return reverse(g);}return g;
 }});assert.equal((await host.query(f.request,f.context)).status,'matches_found');assert.ok(n>1);assert.equal(f.state.reads,1);
});
