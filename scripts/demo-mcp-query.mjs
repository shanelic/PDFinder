// Serialized synthetic MCP messages through local Request/Response only.
// No MCP registration/server/transport, network, login or mobile test.
import {createSyntheticMcpQuery} from '../src/synthetic-mcp-query.mjs';
import {createSyntheticHostHttp} from '../src/synthetic-host-http.mjs';
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
 const origin='https://synthetic.example.invalid',http=createSyntheticHostHttp({host,trustedOrigin:origin});
 const mcp=createSyntheticMcpQuery({http,trustedOrigin:origin});
 for(const stage of ['success','no_match','caller_identity','fake_context','revoked']){
  const before=reads;if(stage==='revoked')active=false;let status;
  try{const message=JSON.parse(JSON.stringify({jsonrpc:'2.0',id:stage,method:'tools/call',params:{_meta:{'io.modelcontextprotocol/protocolVersion':'2026-07-28','io.modelcontextprotocol/clientCapabilities':{}},name:'search_synthetic_selected_pdf',arguments:{selection_ref:ref,query:stage==='no_match'?'zzzz-no-match':'PDF',...(stage==='caller_identity'?{principal_id:principal}:{})}}}));const response=JSON.parse(JSON.stringify(await mcp.handle(message,stage==='fake_context'?{}:hostContext)));if(response.id!==stage||JSON.stringify(JSON.parse(response.result.content[0].text))!==JSON.stringify(response.result.structuredContent))throw Error('MCP result mismatch');const result=response.result.structuredContent;status=result.status??result.error;}
  catch(e){status=e.code;}
  const expected={success:'matches_found',no_match:'no_match',caller_identity:'invalid_request',fake_context:'authentication_failed',revoked:'selection_unavailable'}[stage];
  if(status!==expected||(!['success','no_match'].includes(stage)&&reads!==before))throw Error('Synthetic host demo failed');cases.push({provider:f.connection.provider,stage,status,fake_mail_reads:reads-before});
 }
}
console.log(JSON.stringify({synthetic_only:true,cases,live_mail_reads:0,limitations:['Callbacks simulate trusted host sessions; no real authentication or mobile test','Context must be injected by server, never from request body','Revocation rechecks discard results but cannot unread bytes or stop already-running parsing']},null,2));
