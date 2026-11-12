import test from 'node:test';
import assert from 'node:assert/strict';
import {createSyntheticAttachmentApi} from '../src/synthetic-attachment-api.mjs';
import {fixedFixtures} from '../src/fixed-fixtures.mjs';
import {loadParser} from '../src/lazy-loader.mjs';
import {findLiteralMatches} from '../src/page-citations.mjs';

const password='SYNTHETIC-ONLY-DO-NOT-USE';
const sources=fixedFixtures.flatMap((f,i)=>['gmail','icloud'].map(provider=>({
  source_ref:`synthetic-${provider}-${i}`,provider,account_ref:`synthetic-${provider}-account`,
  message_id:`synthetic-message-${i}`,attachment_id:`synthetic-attachment-${i}`,
  filename:f.fixture_id,sha256:f.sha256
})));
const bodyFor=(source,query='PDF')=>{
  const f=fixedFixtures.find(f=>f.fixture_id===source.filename);
  return {source_ref:source.source_ref,filename:f.fixture_id,data_base64:f.data,sha256:f.sha256,
    password_profile:f.encrypted?'synthetic-fixture':null,query};
};
const request=(body,options={})=>new Request('https://synthetic.invalid/v1/synthetic/search',{
  method:'POST',headers:{'content-type':'application/json',...options.headers},
  body:typeof body==='string'?body:JSON.stringify(body),signal:options.signal
});
const api=(options={})=>createSyntheticAttachmentApi({sources,resolvePassword:async()=>password,loadParser,...options});
const encrypted=sources.find(s=>s.provider==='gmail' && s.filename==='AES-256.pdf');
const plain=sources[0];
async function expectError(worker,req,code,status=422) {
  const response=await worker.fetch(req);
  assert.equal(response.status,status);assert.deepEqual(await response.json(),{error:code});
}

// This mock returns host-normalized originals. Its shape is deliberately NOT
// labeled as Gmail/iCloud's actual tool response or a verified live decoder.
function fakeMailbox(source) {
  return {async getSelectedOriginal(ref) {
    assert.equal(ref,source.source_ref);
    const f=fixedFixtures.find(f=>f.fixture_id===source.filename);
    return {source:{...source},bytes:Uint8Array.from(atob(f.data),c=>c.charCodeAt(0))};
  }};
}

for(const source of sources) test(`normalized ${source.provider} original -> real parser -> citation: ${source.filename}`,async()=>{
  const original=await fakeMailbox(source).getSelectedOriginal(source.source_ref);
  const f=fixedFixtures.find(f=>f.fixture_id===source.filename);
  const query=f.fixture_id.startsWith('chinese')?'雲端':f.fixture_id==='fixture-baseline.pdf'?'中文':'PDF';
  const body=bodyFor(source,query);
  body.data_base64=btoa(String.fromCharCode(...original.bytes));
  let resolutions=0,fetches=0;const oldFetch=globalThis.fetch;
  globalThis.fetch=()=>{fetches++;throw Error('unexpected outbound fetch');};
  try {
    const worker=api({resolvePassword:async(profile,boundSource)=>{
      resolutions++;assert.equal(profile,'synthetic-fixture');assert.deepEqual(boundSource,source);return password;
    }});
    const response=await worker.fetch(request(body));assert.equal(response.status,200);
    const result=await response.json();assert.equal(result.status,'matches_found');
    assert.equal(result.sha256,f.sha256);assert.equal(result.page_count,f.expectedPages.length);
    assert.equal(result.coverage.assessment,'not_a_completeness_proof');
    assert.equal(result.matches.length,1);assert.deepEqual(result.source,source);
    for(const citation of result.matches) {
      const text=Array.from(f.expectedPages[citation.page-1].text);
      assert.deepEqual(citation.source,source);assert.equal(citation.sha256,f.sha256);
      assert.equal(citation.range.unit,'unicode_codepoint');assert.equal(citation.range.end_exclusive,true);
      assert.equal(text.slice(citation.range.start,citation.range.end).join(''),citation.quote);
      assert.equal(text.slice(citation.context.start,citation.context.end).join(''),citation.context.text);
      assert.equal(citation.quote,query);assert.equal(Object.hasOwn(citation,'url'),false);
    }
    assert.equal(resolutions,f.encrypted?1:0);assert.equal(fetches,0);
    assert.equal(JSON.stringify(result).includes(password),false);
  } finally {globalThis.fetch=oldFetch;}
});

test('literal no-match is distinct from unreadable or complete-document proof',async()=>{
  const r=await api().fetch(request(bodyFor(plain,'pdf')));const b=await r.json();
  assert.equal(r.status,200);assert.equal(b.status,'no_match');assert.deepEqual(b.matches,[]);
  assert.equal(b.search.mode,'literal_case_sensitive');assert.equal(b.search.truncated,false);
  assert.equal(b.coverage.assessment,'not_a_completeness_proof');
});

test('match cap is explicit, not a silently complete search',()=>{
  const result=findLiteralMatches([{page:1,text:'a'.repeat(21)}],'a',plain,plain.sha256);
  assert.equal(result.matches.length,20);assert.equal(result.truncated,true);
  assert.equal(findLiteralMatches([{page:1,text:'a'.repeat(20)}],'a',plain,plain.sha256).truncated,false);
});
test('citation offsets are codepoints, including astral characters',()=>{
  const page={page:1,text:'🙂𐐀中文🙂 tail'};
  const result=findLiteralMatches([page],'中文🙂',plain,plain.sha256);
  assert.deepEqual(result.matches[0].range,{start:2,end:5,unit:'unicode_codepoint',end_exclusive:true});
  assert.equal(Array.from(page.text).slice(2,5).join(''),result.matches[0].quote);
  assert.equal(result.matches[0].context.text,page.text);
});
test('literal punctuation and overlapping matches are not regex searches',()=>{
  assert.equal(findLiteralMatches([{page:2,text:'aaa.*'}],'aa',plain,plain.sha256).matches.length,2);
  assert.equal(findLiteralMatches([{page:2,text:'aaa.*'}],'.*',plain,plain.sha256).matches[0].range.start,3);
  assert.throws(()=>findLiteralMatches([{page:1,text:'abc'}],'',plain,plain.sha256),/Nonempty/);
});

test('profile is resolved per request and revocation/restore is observable',async()=>{
  let secret=password,calls=0;const worker=api({resolvePassword:async()=>{calls++;return secret;}});
  assert.equal((await worker.fetch(request(bodyFor(encrypted)))).status,200);
  secret='PUBLIC-INTENTIONALLY-WRONG';await expectError(worker,request(bodyFor(encrypted)),'incorrect_password');
  secret=undefined;await expectError(worker,request(bodyFor(encrypted)),'password_profile_unavailable');
  secret=password;assert.equal((await worker.fetch(request(bodyFor(encrypted)))).status,200);assert.equal(calls,4);
});

const invalidCases=[
  ['unknown source',v=>v.source_ref='synthetic-not-selected','source_not_selected',403],
  ['wrong filename',v=>v.filename='other.pdf','source_mismatch',422],
  ['wrong hash',v=>v.sha256='0'.repeat(64),'source_mismatch',422],
  ['tampered bytes',v=>v.data_base64='A'+v.data_base64.slice(1),'attachment_integrity_failed',422],
  ['bad base64',v=>v.data_base64='!'+v.data_base64.slice(1),'invalid_attachment',422],
  ['oversize encoded attachment',v=>v.data_base64+='AAAA','invalid_attachment',422],
  ['missing profile',v=>v.password_profile=null,'invalid_password_profile',422],
  ['unknown profile',v=>v.password_profile='private-password','invalid_password_profile',422],
  ['raw password prohibited',v=>v.password='DO-NOT-LEAK','invalid_input',400],
  ['empty query',v=>v.query='','invalid_input',400],
  ['oversize query',v=>v.query='a'.repeat(81),'invalid_input',400],
  ['query control character',v=>v.query='a\n','invalid_input',400],
  ['query unpaired surrogate',v=>v.query='\ud800','invalid_input',400],
  ['missing field',v=>delete v.sha256,'invalid_input',400],
  ['nested field',v=>v.query={text:'PDF'},'invalid_input',400]
];
for(const [label,mutate,code,status] of invalidCases) test(`${label}: rejected before resolver/parser`,async()=>{
  let calls=0;const worker=api({resolvePassword:async()=>{calls++;return password;},loadParser:async()=>{calls++;throw Error('must not initialize');}});
  const body=bodyFor(encrypted);mutate(body);await expectError(worker,request(body),code,status);assert.equal(calls,0);
});

test('plaintext forbids a password profile',async()=>{
  const body=bodyFor(plain);body.password_profile='synthetic-fixture';
  await expectError(api(),request(body),'invalid_password_profile');
});
test('unknown fields, duplicate and escaped keys are rejected',async()=>{
  const original=JSON.stringify(bodyFor(plain));
  for(const raw of [original.replace('{','{"query":"PDF",'),original.replace('"query"','"qu\\u0065ry"'),original.replace('{','{"__proto__":{},')])
    await expectError(api(),request(raw),'invalid_input',400);
});
test('oversize body and content-length mismatch are rejected',async()=>{
  await expectError(api(),request(' '.repeat(32769)),'input_too_large',413);
  await expectError(api(),request(bodyFor(plain),{headers:{'content-length':'1'}}),'content_length_mismatch',400);
});
test('route, method, encoding and media type are restricted',async()=>{
  await expectError(api(),new Request('https://synthetic.invalid/v1/synthetic/search?x=1'),'invalid_route',404);
  await expectError(api(),new Request('https://synthetic.invalid/v1/synthetic/search'),'method_not_allowed',405);
  await expectError(api(),request(bodyFor(plain),{headers:{'content-type':'text/plain'}}),'unsupported_media_type',415);
  await expectError(api(),request(bodyFor(plain),{headers:{'content-encoding':'gzip'}}),'invalid_encoding',400);
});
test('unselected source metadata cannot be provided as caller fields',async()=>{
  const body=bodyFor(plain);body.source={provider:'gmail',message_id:'synthetic-other'};
  await expectError(api(),request(body),'invalid_input',400);
});
test('duplicate names across providers retain different source citations',async()=>{
  const gmail=await (await api().fetch(request(bodyFor(sources[0])))).json();
  const icloud=await (await api().fetch(request(bodyFor(sources[1])))).json();
  assert.equal(gmail.sha256,icloud.sha256);assert.equal(gmail.source.filename,icloud.source.filename);
  assert.notDeepEqual(gmail.matches[0].source,icloud.matches[0].source);
});
test('incomplete and forged parser output cannot become citations',async()=>{
  for(const pages of [[],[{page:1,text:''}],[{page:1,text:'fabricated'}],fixedFixtures[0].expectedPages.map(p=>({...p,extra:'secret'}))]) {
    const worker=api({loadParser:async()=>async()=>({pages,text_status:'text_found',coverage:{assessment:'not_a_completeness_proof'}})});
    await expectError(worker,request(bodyFor(plain)),'fixture_text_mismatch');
  }
});
test('source configuration is copied before requests and cannot claim live accounts',async()=>{
  const s=structuredClone(sources);const worker=api({sources:s});s[0].message_id='synthetic-mutated';
  const b=await (await worker.fetch(request(bodyFor(plain)))).json();assert.equal(b.source.message_id,plain.message_id);
  assert.throws(()=>api({sources:[{...plain,account_ref:'live-account'}]}),/Invalid synthetic source/);
  assert.throws(()=>api({sources:[plain,plain]}),/Invalid synthetic source/);
});
test('pre-aborted request does not initialize parser',async()=>{
  const controller=new AbortController();controller.abort();let initialized=false;
  const worker=api({loadParser:async()=>{initialized=true;throw Error('unreachable');}});
  await expectError(worker,request(bodyFor(plain),{signal:controller.signal}),'request_cancelled',499);assert.equal(initialized,false);
});
test('abort during pending body read is classified after the source settles',async()=>{
  let streamController,entered;const reading=new Promise(r=>entered=r);
  const stream=new ReadableStream({start(c){streamController=c;},pull(){entered();}},{highWaterMark:0});
  const controller=new AbortController();let initialized=false;
  const worker=api({loadParser:async()=>{initialized=true;throw Error('unreachable');}});
  const req=new Request('https://synthetic.invalid/v1/synthetic/search',{method:'POST',headers:{'content-type':'application/json'},body:stream,duplex:'half',signal:controller.signal});
  const pending=worker.fetch(req);await reading;controller.abort();streamController.close();
  const result=await pending;assert.equal(result.status,499);assert.deepEqual(await result.json(),{error:'request_cancelled'});
  assert.equal(initialized,false);
});
test('overlap rejected; cancellation after parsing discards results',async()=>{
  let release,entered;const waiting=new Promise(r=>release=r),started=new Promise(r=>entered=r);
  const controller=new AbortController();const worker=api({loadParser:async()=>async()=>{entered();await waiting;return {pages:fixedFixtures[0].expectedPages,text_status:'text_found',coverage:{assessment:'not_a_completeness_proof'}};}});
  const pending=worker.fetch(request(bodyFor(plain),{signal:controller.signal}));await started;
  await expectError(worker,request(bodyFor(plain)),'busy',429);controller.abort();release();
  const result=await pending;assert.equal(result.status,499);assert.deepEqual(await result.json(),{error:'request_cancelled'});
});
test('unexpected errors and resolver errors disclose no detail or logs',async()=>{
  const logs=[],old={log:console.log,warn:console.warn,error:console.error};
  for(const key of Object.keys(old)) console[key]=(...v)=>logs.push(v);
  try {
    for(const where of ['resolver','parser']) {
      const worker=api(where==='resolver'?{resolvePassword:async()=>{throw Error('DO-NOT-LEAK');}}:{loadParser:async()=>{throw Error('DO-NOT-LEAK');}});
      await expectError(worker,request(bodyFor(encrypted)),'extraction_failed',500);
    }
    assert.equal(logs.length,0);
  } finally {Object.assign(console,old);}
});
