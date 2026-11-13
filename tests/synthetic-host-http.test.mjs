import test from 'node:test';
import assert from 'node:assert/strict';
import {createSyntheticHostHttp} from '../src/synthetic-host-http.mjs';
import {createSyntheticHostQuery} from '../src/synthetic-host-query.mjs';
import {createSyntheticPasswordProfiles,createInMemorySyntheticProfileStorage,createSyntheticProfileScope} from '../src/synthetic-password-profiles.mjs';
import {makeSyntheticProviderResponse} from './helpers/synthetic-provider-response.mjs';
import {fixedFixtures} from '../src/fixed-fixtures.mjs';
import {loadParser} from '../src/lazy-loader.mjs';
const origin='https://synthetic.example.invalid',url=origin+'/v1/selected-mail/search',body={selection_ref:'synthetic-selection',query:'PDF'};
const request=(options={})=>new Request(options.url??url,{method:options.method??'POST',headers:{origin,'content-type':'application/json',...options.headers},...(options.method==='GET'?{}:{body:options.body??JSON.stringify(body),duplex:'half'}),signal:options.signal});
async function setup(provider='gmail'){
 const profile='synthetic-profile',fixture=fixedFixtures.find(f=>f.fixture_id==='AES-256.pdf'),f=makeSyntheticProviderResponse(provider,Uint8Array.from(atob(fixture.data),c=>c.charCodeAt(0)),{filename:fixture.fixture_id,profile});
 const service=createSyntheticPasswordProfiles({storage:createInMemorySyntheticProfileStorage()});await service.create({profile_id:profile,value_id:'fixture-aes256',scopes:[createSyntheticProfileScope(f.connection,f.selection.source)]});
 const context=Object.freeze({}),state={active:true,session:true,reads:0};
 const host=createSyntheticHostQuery({authenticate:async ctx=>ctx===context&&state.session?{principal_id:'synthetic-principal',connection_ref:f.connection.connection_ref}:null,
 readGrant:async()=>({principal_id:'synthetic-principal',selection_ref:body.selection_ref,revision:1,active:state.active,connection:f.connection,route:f.route,selection:{source:f.selection.source,size_bytes:f.selection.size_bytes,password_profile:profile}}),loadParser,
 resolvePassword:async(c,p,s)=>service.resolverFor(c)(p,s),invoke:async()=>{state.reads++;return f.response;},readOriginal:async()=> (async function*(){yield f.bytes.slice();})()});
 return {http:createSyntheticHostHttp({host,trustedOrigin:origin}),context,state,f,service};
}
for(const provider of ['gmail','icloud'])test(provider+' HTTP real parser matches/no-match preserves citations',async()=>{const f=await setup(provider);for(const query of ['PDF','zzzz-no-match']){const response=await f.http.fetch(request({body:JSON.stringify({...body,query})}),f.context),result=await response.json();assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('access-control-allow-origin'),null);if(query==='PDF'){assert.equal(result.status,'matches_found');assert.deepEqual(result.matches[0].source,f.f.selection.source);}else assert.equal(result.status,'no_match');}});
for(const [name,options,status]of [['cross origin',{headers:{origin:'https://other.invalid'}},403],['cross URL',{url:'https://other.invalid/v1/selected-mail/search'},403],['cross-site metadata',{headers:{'sec-fetch-site':'cross-site'}},403],['route',{url:url+'?account=bad'},404],['method',{method:'GET'},405],['media',{headers:{'content-type':'text/plain'}},415],['encoding',{headers:{'content-encoding':'gzip'}},415],['oversize',{body:'x'.repeat(2049)},413],['declared oversize',{headers:{'content-length':'2049'}},413],['length mismatch',{headers:{'content-length':'1'}},400],['malformed JSON',{body:'{'},400],['duplicate keys',{body:'{"query":"PDF","query":"PDF"}'},400],['claimed identity',{body:JSON.stringify({...body,authenticated:true})},400],['array',{body:'[]'},400],['invalid UTF8',{body:new Uint8Array([255])},400]])test(name+' rejected before host reads',async()=>{const f=await setup();const r=await f.http.fetch(request(options),f.context);assert.equal(r.status,status);assert.equal(f.state.reads,0);assert.equal(r.headers.get('cache-control'),'no-store');});
test('headers never grant session identity',async()=>{const f=await setup();const r=await f.http.fetch(request({headers:{authorization:'Bearer DO-NOT-LEAK','x-authenticated':'true'}}),{});assert.equal(r.status,401);assert.equal(f.state.reads,0);assert.ok(!(await r.text()).includes('DO-NOT-LEAK'));});
test('revoked grant and session failure rejected',async()=>{const f=await setup();f.state.active=false;assert.equal((await f.http.fetch(request(),f.context)).status,404);f.state.session=false;assert.equal((await f.http.fetch(request(),f.context)).status,401);assert.equal(f.state.reads,0);});
test('profile revocation maps to stable422',async()=>{const f=await setup();await f.service.revoke({profile_id:'synthetic-profile',expected_revision:1});const r=await f.http.fetch(request(),f.context);assert.equal(r.status,422);assert.deepEqual(await r.json(),{error:'profile_unavailable'});});
test('unknown host exception is sanitized',async()=>{const http=createSyntheticHostHttp({trustedOrigin:origin,host:{query:async()=>{throw Error('DO-NOT-LEAK');}}});const r=await http.fetch(request(),{});assert.equal(r.status,500);assert.deepEqual(await r.json(),{error:'query_failed'});});
test('pre-aborted request never invokes host',async()=>{let calls=0;const http=createSyntheticHostHttp({trustedOrigin:origin,host:{query:async()=>calls++}}),controller=new AbortController();controller.abort();const r=await http.fetch(request({signal:controller.signal}),{});assert.equal(r.status,499);assert.equal(calls,0);});
test('abort during host work discards response; underlying operation may still finish',{timeout:5000},async()=>{let release,started;const gate=new Promise(r=>release=r),start=new Promise(r=>started=r);let finished=false;const http=createSyntheticHostHttp({trustedOrigin:origin,host:{query:async()=>{started();await gate;finished=true;return {private:'DO-NOT-LEAK'};}}});const controller=new AbortController(),pending=http.fetch(request({signal:controller.signal}),{});await start;controller.abort();const r=await pending;assert.equal(r.status,499);assert.equal(finished,false);release();await new Promise(r=>setImmediate(r));assert.equal(finished,true);assert.ok(!(await r.text()).includes('DO-NOT-LEAK'));});
test('abort during stalled body read cancels body and does not call host',{timeout:5000},async()=>{let calls=0,cancelled=false;const stream=new ReadableStream({cancel(){cancelled=true;}}),controller=new AbortController(),http=createSyntheticHostHttp({trustedOrigin:origin,host:{query:async()=>calls++}});const pending=http.fetch(request({body:stream,signal:controller.signal}),{});controller.abort();assert.equal((await pending).status,499);assert.equal(calls,0);assert.equal(cancelled,true);});
test('chunk budget bounds empty-chunk streams',async()=>{let calls=0,n=0;const stream=new ReadableStream({pull(c){if(n++<129)c.enqueue(new Uint8Array());else c.close();}}),http=createSyntheticHostHttp({trustedOrigin:origin,host:{query:async()=>calls++}});assert.equal((await http.fetch(request({body:stream}),{})).status,413);assert.equal(calls,0);});

test('UTF8 byte limit is not character count',async()=>{const f=await setup();const r=await f.http.fetch(request({body:JSON.stringify({...body,query:'中'.repeat(700)})}),f.context);assert.equal(r.status,413);assert.equal(f.state.reads,0);});
test('hostile thrown error cannot expose exception or break response contract',async()=>{
 const http=createSyntheticHostHttp({trustedOrigin:origin,host:{query:async()=>{throw new Proxy({},{getPrototypeOf(){throw Error('DO-NOT-LEAK');}});}}});const r=await http.fetch(request(),{});assert.equal(r.status,500);assert.deepEqual(await r.json(),{error:'query_failed'});
});
test('known document and mail errors map to sanitized stable responses',async()=>{
 const {DocumentSearchError}=await import('../src/bounded-document-search.mjs');const {SelectedMailSearchError}=await import('../src/selected-mail-search.mjs');
 for(const [exception,status,code]of [[new DocumentSearchError('incorrect_password'),422,'document_processing_failed'],[new SelectedMailSearchError('mail_read_failed'),502,'mail_processing_failed']]){
  const http=createSyntheticHostHttp({trustedOrigin:origin,host:{query:async()=>{throw exception;}}});const r=await http.fetch(request(),{});assert.equal(r.status,status);assert.deepEqual(await r.json(),{error:code});
 }
});

for(const code of ['cleanup_failed','parser_failed','invalid_parser_result','invalid_limits'])test('internal document failure maps to500: '+code,async()=>{
 const {DocumentSearchError}=await import('../src/bounded-document-search.mjs');
 const http=createSyntheticHostHttp({trustedOrigin:origin,host:{query:async()=>{throw new DocumentSearchError(code);}}});
 const response=await http.fetch(request(),{});assert.equal(response.status,500);assert.deepEqual(await response.json(),{error:'document_processing_failed'});assert.equal(response.headers.get('cache-control'),'no-store');
});
