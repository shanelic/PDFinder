// Local synthetic-only lifecycle. No live provider call, secret or persistence.
import {createInMemorySyntheticProfileStorage,createSyntheticPasswordProfiles,createSyntheticProfileScope} from '../src/synthetic-password-profiles.mjs';
import {createSelectedMailSearch} from '../src/selected-mail-search.mjs';
import {makeSyntheticProviderResponse} from '../tests/helpers/synthetic-provider-response.mjs';
import {fixedFixtures} from '../src/fixed-fixtures.mjs';
import {loadParser} from '../src/lazy-loader.mjs';
const profile='synthetic-public-profile',fixture=fixedFixtures.find(f=>f.fixture_id==='AES-256.pdf');
const providers=['gmail','icloud'].map(provider=>makeSyntheticProviderResponse(provider,Uint8Array.from(atob(fixture.data),c=>c.charCodeAt(0)),{filename:fixture.fixture_id,profile}));
const service=createSyntheticPasswordProfiles({storage:createInMemorySyntheticProfileStorage()});
const states=[await service.create({profile_id:profile,value_id:'fixture-aes256',scopes:providers.map(f=>createSyntheticProfileScope(f.connection,f.selection.source))})];
const cases=[];let fakeReads=0;
const bridges=providers.map(f=>createSelectedMailSearch({...f,loadParser,resolvePassword:service.resolverFor(f.connection),invoke:async()=>{fakeReads++;return f.response;},
 readOriginal:async()=> (async function*(){yield f.bytes.slice();})()}));
async function run(stage,expected){
 for(let n=0;n<providers.length;n++){
  let observed;
  try {const r=await bridges[n].search(providers[n].selection);observed=r.status;cases.push({provider:providers[n].connection.provider,stage,status:observed,page_count:r.page_count,match_count:r.matches.length});}
  catch(e){observed=e.code;cases.push({provider:providers[n].connection.provider,stage,error:observed});}
  if(observed!==expected)throw Error('Synthetic lifecycle demo failed');
 }
}
await run('first_use','matches_found');await run('reuse','matches_found');
states.push(await service.replace({profile_id:profile,expected_revision:1,value_id:'wrong-test-value'}));await run('replaced_wrong_value','incorrect_password');
states.push(await service.replace({profile_id:profile,expected_revision:2,value_id:'fixture-aes256'}));await run('restored_public_value','matches_found');
states.push(await service.revoke({profile_id:profile,expected_revision:3}));await run('revoked','profile_unavailable');
console.log(JSON.stringify({scope:'local_synthetic_profile_and_fake_mail_only',storage:'in_memory_only_lost_on_restart',real_secrets_accepted:false,live_mail_reads:0,mail_sent:false,cloud_deployment:false,
 fake_response_reads:fakeReads,states,cases,limitations:['Trusted injected storage is not a vault or account authentication','Already-resolved in-flight parsing may finish after revoke','No cross-process persistence, rollback protection or secure erasure proof']},null,2));
