// Local-only fake envelopes + real PDF.js. Each phase is a fresh Node process.
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createSyntheticFileProfileStorage} from '../src/synthetic-file-profile-storage.mjs';
import {createSyntheticPasswordProfiles,createSyntheticProfileScope} from '../src/synthetic-password-profiles.mjs';
import {makeSyntheticProviderResponse} from '../tests/helpers/synthetic-provider-response.mjs';
import {fixedFixtures} from '../src/fixed-fixtures.mjs';
import {createSelectedMailSearch} from '../src/selected-mail-search.mjs';
import {loadParser} from '../src/lazy-loader.mjs';
const id='synthetic-restart-profile';
if(process.argv[2]==='--child'){
 const [directory,phase]=process.argv.slice(3),fixture=fixedFixtures.find(f=>f.fixture_id==='AES-256.pdf');
 const fixtures=['gmail','icloud'].map(provider=>makeSyntheticProviderResponse(provider,Uint8Array.from(atob(fixture.data),c=>c.charCodeAt(0)),{filename:fixture.fixture_id,profile:id}));
 const service=createSyntheticPasswordProfiles({storage:await createSyntheticFileProfileStorage({directory,initialize:phase==='create'})});
 if(phase==='create')await service.create({profile_id:id,value_id:'fixture-aes256',scopes:fixtures.map(f=>createSyntheticProfileScope(f.connection,f.selection.source))});
 if(phase==='wrong')await service.replace({profile_id:id,expected_revision:1,value_id:'wrong-test-value'});
 if(phase==='restore')await service.replace({profile_id:id,expected_revision:2,value_id:'fixture-aes256'});
 if(phase==='revoke')await service.revoke({profile_id:id,expected_revision:3});
 const expected=phase==='wrong'?'incorrect_password':['revoke','reopen-revoked'].includes(phase)?'profile_unavailable':'matches_found';
 const results=[];
 for(const f of fixtures){
  const bridge=createSelectedMailSearch({...f,loadParser,resolvePassword:service.resolverFor(f.connection),invoke:async()=>f.response,readOriginal:async()=> (async function*(){yield f.bytes.slice();})()});
  let status;try{status=(await bridge.search(f.selection)).status;}catch(e){status=e.code;}
  if(status!==expected)throw Error('Synthetic restart acceptance failed');results.push({provider:f.connection.provider,status});
 }
 console.log('RESULT '+JSON.stringify({phase,results,metadata:await service.describe(id)}));
}else{
 const directory=await mkdtemp(join(tmpdir(),'pdfinder-synthetic-profiles-'));
 try{
  const phases=['create','reopen','wrong','restore','revoke','reopen-revoked'],results=[];
  for(const phase of phases){const output=execFileSync(process.execPath,[fileURLToPath(import.meta.url),'--child',directory,phase],{encoding:'utf8'});results.push(JSON.parse(output.split('\n').find(line=>line.startsWith('RESULT ')).slice(7)));}
  console.log(JSON.stringify({synthetic_only:true,fresh_processes:6,cases:12,results,limitations:['Not a vault; public IDs stored as plaintext JSON','Cooperating lock only; no hostile local process, rollback, power-loss or secure-erasure protection','In-flight parsing may finish after revoke'],live_provider_calls:0},null,2));
 }finally{await rm(directory,{recursive:true,force:true});}
}
