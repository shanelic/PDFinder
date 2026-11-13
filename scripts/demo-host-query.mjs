// Synthetic callback demonstration, not login/session verification or HTTP.
import {createSyntheticHostQuery} from '../src/synthetic-host-query.mjs';
import {createSyntheticPasswordProfiles,createInMemorySyntheticProfileStorage,createSyntheticProfileScope} from '../src/synthetic-password-profiles.mjs';
import {makeSyntheticProviderResponse} from '../tests/helpers/synthetic-provider-response.mjs';
import {fixedFixtures} from '../src/fixed-fixtures.mjs';
import {loadParser} from '../src/lazy-loader.mjs';
const profile='synthetic-profile',fixture=fixedFixtures.find(f=>f.fixture_id==='AES-256.pdf');
const service=createSyntheticPasswordProfiles({storage:createInMemorySyntheticProfileStorage()});
const fixtures=['gmail','icloud'].map(provider=>makeSyntheticProviderResponse(provider,Uint8Array.from(atob(fixture.data),c=>c.charCodeAt(0)),{filename:fixture.fixture_id,profile}));
await service.create({profile_id:profile,value_id:'fixture-aes256',scopes:fixtures.map(f=>createSyntheticProfileScope(f.connection,f.selection.source))});
const cases=[];
for(const f of fixtures){
 const principal='synthetic-principal',ref='synthetic-selection',hostContext=Object.freeze({});let active=true,reads=0;
 const fakeSessions=new WeakMap([[hostContext,{principal_id:principal,connection_ref:f.connection.connection_ref}]]);
 const host=createSyntheticHostQuery({authenticate:async ctx=>fakeSessions.get(ctx),readGrant:async(p,r)=>p===principal&&r===ref?{principal_id:principal,selection_ref:ref,revision:1,active,connection:f.connection,route:f.route,selection:{source:f.selection.source,size_bytes:f.selection.size_bytes,password_profile:profile}}:null,
 loadParser,resolvePassword:async(connection,id,source)=>service.resolverFor(connection)(id,source),invoke:async()=>{reads++;return f.response;},readOriginal:async()=> (async function*(){yield f.bytes.slice();})()});
 for(const stage of ['success','caller_identity','fake_context','revoked']){
  const before=reads;if(stage==='revoked')active=false;let status;
  try{const result=await host.query({selection_ref:ref,query:'PDF',...(stage==='caller_identity'?{principal_id:principal}:{})},stage==='fake_context'?{}:hostContext);status=result.status;}
  catch(e){status=e.code;}
  const expected={success:'matches_found',caller_identity:'invalid_request',fake_context:'authentication_failed',revoked:'selection_unavailable'}[stage];
  if(status!==expected||(stage!=='success'&&reads!==before))throw Error('Synthetic host demo failed');cases.push({provider:f.connection.provider,stage,status,fake_mail_reads:reads-before});
 }
}
console.log(JSON.stringify({synthetic_only:true,cases,live_mail_reads:0,limitations:['Callbacks simulate trusted host sessions; no real authentication or mobile test','Context must be injected by server, never from request body','Revocation rechecks discard results but cannot unread bytes or stop already-running parsing']},null,2));
