import {createCandidate} from '../src/candidate-factory.mjs';
import {fixedFixtures} from '../src/fixed-fixtures.mjs';
import {createGuardedExtractor} from '../src/guarded-extractor.mjs';

// Public dummy credentials, never runtime configuration or real credentials.
export const FAKE_TOKEN='PUBLIC-FAKE-TEST-CREDENTIAL-NOT-A-SECRET';
const BASE=Date.parse('2026-11-11T12:00:00Z');
const encoder=new TextEncoder();
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const err=(name,code)=>Object.assign(new Error('DO-NOT-LEAK-RAW-ERROR'),{name,code});
const GOOD={pages:[{...fixedFixtures[0].expectedPages[0]}],text_status:'text_found',coverage:{assessment:'not_a_completeness_proof',status:'standard_font_fallback_used',requested_resources:1,delivered_bytes:0,cmap_names:[],standard_font_fallback_count:1}};
export const testEnv=(time=BASE)=>({BENCHMARK_ACCESS_TOKEN:FAKE_TOKEN,BENCHMARK_EXPIRES_AT:new Date(Math.floor((time+600000)/1000)*1000).toISOString().replace('.000Z','Z')});
export function makeRequest(input={fixture_id:'plain.pdf'},options={}){
 const {raw,headers={},url='https://synthetic.invalid/benchmark',method='POST',signal}=options;
 const body=raw===undefined?JSON.stringify(input):raw;
 return new Request(url,{method,headers:{authorization:'Bearer '+FAKE_TOKEN,'content-type':'application/json',...headers},...(method==='GET'?{}:{body,duplex:'half'}),signal});
}
export async function runInterfaceSuite(){
 const labels=[];let loaders=0,extracts=0;
 const ok=(condition,label)=>{if(!condition)throw new Error('FAILED '+label);labels.push(label);};
 const check=async(worker,request,code,status,env=testEnv())=>{
  const response=await worker.fetch(request,env),body=await response.json();
  ok(response.status===status&&body.error===code,code+' '+status);
  ok(response.headers.get('cache-control')==='no-store'&&response.headers.get('x-content-type-options')==='nosniff','safe response headers '+code);
  ok(!JSON.stringify(body).includes('DO-NOT-LEAK')&&!JSON.stringify(body).includes(FAKE_TOKEN),'redacted '+code);
  return body;
 };
 const base=()=>createCandidate({fixtures:fixedFixtures,now:()=>BASE,loadParser:async()=>{loaders++;return async()=>{extracts++;return structuredClone(GOOD);};}});
 let worker=base();
 const gates=[
  [makeRequest(),{},'authorization_not_configured_or_expired',503],
  [makeRequest(),{BENCHMARK_ACCESS_TOKEN:FAKE_TOKEN},'authorization_not_configured_or_expired',503],
  [makeRequest(),{...testEnv(),BENCHMARK_EXPIRES_AT:'2026-11-11T12:00:00Z'},'authorization_not_configured_or_expired',503],
  [makeRequest(),{...testEnv(),BENCHMARK_EXPIRES_AT:'2026-11-11T12:30:01Z'},'authorization_not_configured_or_expired',503],
  [makeRequest(),{...testEnv(),BENCHMARK_EXPIRES_AT:'2026-02-30T12:10:00Z'},'authorization_not_configured_or_expired',503],
  [makeRequest(),{...testEnv(),BENCHMARK_EXPIRES_AT:'2026-11-11T12:10:00.000Z'},'authorization_not_configured_or_expired',503],
  [makeRequest(),{...testEnv(),BENCHMARK_EXPIRES_AT:'2026-11-11T13:10:00+01:00'},'authorization_not_configured_or_expired',503],
  [makeRequest(),{...testEnv(),BENCHMARK_ACCESS_TOKEN:'short'},'authorization_not_configured_or_expired',503],
  [makeRequest({}, {headers:{authorization:''}}),testEnv(),'unauthorized',401],
  [makeRequest({}, {headers:{authorization:'Bearer PUBLIC-FAKE-WRONG-CREDENTIAL-NOT-SECRET'}}),testEnv(),'unauthorized',401],
  [makeRequest({}, {headers:{authorization:'bearer '+FAKE_TOKEN}}),testEnv(),'unauthorized',401],
  [makeRequest({}, {url:'https://synthetic.invalid/benchmark?x=1'}),testEnv(),'invalid_route',404],
  [makeRequest({}, {url:'https://synthetic.invalid/other'}),testEnv(),'invalid_route',404],
  [makeRequest({}, {method:'GET'}),testEnv(),'method_not_allowed',405],
  [makeRequest({}, {headers:{'content-type':'application/json; charset=utf-8'}}),testEnv(),'unsupported_media_type',415],
  [makeRequest({}, {headers:{'content-encoding':'gzip'}}),testEnv(),'invalid_encoding',400],
  [makeRequest({}, {headers:{'content-length':'x'}}),testEnv(),'invalid_content_length',400],
  [makeRequest({}, {headers:{'content-length':'129'}}),testEnv(),'input_too_large',413]
 ];
 for(const [request,env,code,status]of gates){let reads=0;Object.defineProperty(request,'body',{get(){reads++;throw Error('Must not read gated body');}});await check(worker,request,code,status,env);ok(reads===0,'body untouched '+code);}
 ok(loaders===0&&extracts===0,'no parser initialized for header/auth gates');
 for(const raw of ['', '{}','[]','null','{"fixture_id":3}','{"fixture_id":"plain.pdf","url":"https://example.invalid"}','{"fixture_id":"plain.pdf","password":"DO-NOT-LEAK"}','{"fixture_id":"plain.pdf","track":"x"}','{"fixture_id":"plain.pdf","fixture_id":"plain.pdf"}','{"fixture_id":"plain.pdf","password_mode":"correct","password_mode":"correct"}','{"__proto__":"x","fixture_id":"plain.pdf"}','{"fixture_id":"plain.pdf","password_mode":"unknown"}','{"fixture\\u005fid":"plain.pdf"}','\ufeff{"fixture_id":"plain.pdf"}'])await check(worker,makeRequest(null,{raw}),'invalid_input',400);
 await check(worker,makeRequest(null,{raw:new Uint8Array([0xc3,0x28])}),'invalid_utf8',400);
 await check(worker,makeRequest({fixture_id:'DO-NOT-LEAK.pdf'}),'invalid_fixture',400);
 await check(worker,makeRequest({fixture_id:'plain.pdf',password_mode:'wrong'}),'invalid_password_mode',400);
 await check(worker,makeRequest(null,{raw:' '.repeat(129)}),'input_too_large',413);
 await check(worker,makeRequest({fixture_id:'plain.pdf'},{headers:{'content-length':'1'}}),'content_length_mismatch',400);
 const chunked=(chunks,cancel=()=>{})=>new ReadableStream({pull(controller){if(chunks.length)controller.enqueue(chunks.shift());else controller.close();},cancel},{highWaterMark:0});
 await check(worker,makeRequest(null,{raw:chunked([encoder.encode(' '.repeat(80)),encoder.encode(' '.repeat(49))])}),'input_too_large',413);
 await check(worker,makeRequest(null,{raw:chunked([new Uint8Array()])}),'invalid_input',400);
 ok(loaders===0&&extracts===0,'no parser initialized before valid schema and body');
 const releaseFailure=makeRequest();let didRead=false;
 Object.defineProperty(releaseFailure,'body',{value:{getReader(){return {async read(){if(didRead)return {done:true};didRead=true;return {done:false,value:encoder.encode('{"fixture_id":"plain.pdf"}')};},releaseLock(){throw Error('DO-NOT-LEAK-RELEASE');}};}}});
 const brokenReader=base();await check(brokenReader,releaseFailure,'body_cleanup_failed',500);await check(brokenReader,makeRequest(),'isolate_quarantined',503);ok(loaders===0,'EOF releaseLock failure prevents parser initialization');

 for(const change of [f=>({...f,data:'A'+f.data.slice(1)}),f=>({...f,bytes:f.bytes+1}),f=>({...f,sha256:'0'.repeat(64)}),f=>({...f,data:'invalid'})]){
  const bad=createCandidate({fixtures:[change(fixedFixtures[0])],now:()=>BASE,loadParser:async()=>{loaders++;throw Error('DO-NOT-LEAK');}});
  await check(bad,makeRequest(),'fixture_integrity_failed',500);
 }
 ok(loaders===0,'tamper rejected before loader');
 const good=await worker.fetch(makeRequest(),testEnv());const goodBody=await good.json();
 ok(good.status===200&&goodBody.success===true&&goodBody.outcome==='exact_fixture_match','exact fixed result accepted');
 ok(!JSON.stringify(goodBody).includes('Synthetic cloud')&&!JSON.stringify(goodBody).includes('SYNTHETIC-ONLY'),'response excludes text/password');
 ok(goodBody.coverage.assessment==='not_a_completeness_proof','coverage qualifier retained');
 const raw=JSON.stringify({fixture_id:'plain.pdf'}).padEnd(128,' ');
 ok((await worker.fetch(makeRequest(null,{raw:chunked([...encoder.encode(raw)].map(b=>new Uint8Array([b])))}),testEnv())).status===200,'128 one-byte chunks accepted');
 for(const mutate of [r=>r.pages[0].text+=' EXTRA',r=>r.pages[0].text=r.pages[0].text.split('\n')[0],r=>r.pages.push({...r.pages[0]}),r=>r.pages[0].page=2,r=>r.pages[0].text=r.pages[0].text.replace('PDF','ＰＤＦ'),r=>r.pages[0].extra='DO-NOT-LEAK',r=>r.pages=new Array(1)]){
  const result=structuredClone(GOOD);mutate(result);const w=createCandidate({fixtures:fixedFixtures,now:()=>BASE,loadParser:async()=>async()=>result});
  await check(w,makeRequest(),'fixture_text_mismatch',422);
 }
 for(const mutate of [r=>delete r.coverage,r=>r.coverage.assessment='complete',r=>r.coverage.status='complete',r=>r.coverage.delivered_bytes=1048577,r=>r.coverage.cmap_names=['DO-NOT-LEAK'],r=>r.coverage.extra='DO-NOT-LEAK',r=>r.text_status='no_extractable_text',r=>r.coverage.cmap_names=new Array(1)]){
  const result=structuredClone(GOOD);mutate(result);const w=createCandidate({fixtures:fixedFixtures,now:()=>BASE,loadParser:async()=>async()=>result});
  await check(w,makeRequest(),'coverage_assessment_invalid',422);
 }
 for(const [name,code,expected,status]of [['TextCoverageError','invalid_cmap','text_coverage_failed',422],['TextCoverageError','resource_failure','text_coverage_failed',422],['TextCoverageError','font_translation','text_coverage_failed',422],['ExtractionLimitError','page_limit','extraction_limit_exceeded',422],['ExtractionLimitError','text_limit','extraction_limit_exceeded',422],['PdfExtractionError','malformed_pdf','pdf_extraction_failed',500],['AbortError',undefined,'parser_aborted',500],['Error',undefined,'synthetic_parse_failed',500]]){
  const w=createCandidate({fixtures:fixedFixtures,now:()=>BASE,loadParser:async()=>async()=>{throw err(name,code);}});await check(w,makeRequest(),expected,status);
 }
 for(const [mode,code]of [['missing',1],['wrong',2]]){
  let fail=true;const w=createCandidate({fixtures:fixedFixtures,now:()=>BASE,loadParser:async()=>async()=>{if(fail)throw err('PasswordException',code);return structuredClone(GOOD);}});
  const r=await w.fetch(makeRequest({fixture_id:'AES-128.pdf',password_mode:mode}),testEnv());const b=await r.json();
  ok(r.status===200&&b.outcome==='expected_password_error'&&b.page_count===0,'expected '+mode+' result');
  fail=false;ok((await w.fetch(makeRequest(),testEnv())).status===200,'verified password cleanup releases slot '+mode);
  const wrongCode=createCandidate({fixtures:fixedFixtures,now:()=>BASE,loadParser:async()=>async()=>{throw err('PasswordException',code===1?2:1);}});await check(wrongCode,makeRequest({fixture_id:'AES-128.pdf',password_mode:mode}),'unexpected_password_error',500);
 }
 await check(base(),makeRequest({fixture_id:'AES-128.pdf',password_mode:'wrong'}),'unexpected_password_acceptance',500);
 for(const code of ['cleanup_failed','cleanup_timeout']){
  const w=createCandidate({fixtures:fixedFixtures,now:()=>BASE,loadParser:async()=>async()=>{throw err('PdfExtractionError',code);}});
  await check(w,makeRequest(),'pdf_extraction_failed',500);await check(w,makeRequest(),'isolate_quarantined',503);
 }
 // Primary password/parser failures must not mask failed teardown in this copy.
 for(const primary of [err('PasswordException',1),err('InvalidPDFException')]){
  const pdfjs={version:'6.2.108',getDocument(){return {promise:Promise.reject(primary),destroy:async()=>{throw Error('DO-NOT-LEAK-CLEANUP');}};}};
  const extract=createGuardedExtractor(pdfjs);let caught;try{await extract(new Uint8Array([1]));}catch(e){caught=e;}
  ok(caught?.name==='PdfExtractionError'&&caught.code==='cleanup_failed','cleanup error overrides '+primary.name);
 }
 const pending=deferred(),entered=deferred();let calls=0;
 worker=createCandidate({fixtures:fixedFixtures,now:()=>BASE,loadParser:async()=>async()=>{calls++;entered.resolve();await pending.promise;return structuredClone(GOOD);}});
 const running=worker.fetch(makeRequest(),testEnv());await entered.promise;await check(worker,makeRequest(),'busy',429);pending.resolve();ok((await running).status===200,'active job completes');ok(calls===1,'one accepted parser at a time');ok((await worker.fetch(makeRequest(),testEnv())).status===200,'successful cleanup releases slot');
 for(const cancel of [false,true]){
  const wait=deferred(),start=deferred(),controller=new AbortController();let runs=0;
  const w=createCandidate({fixtures:fixedFixtures,now:()=>BASE,parseDeadlineMs:20,loadParser:async()=>async()=>{runs++;start.resolve();await wait.promise;return structuredClone(GOOD);}});
  const r=w.fetch(makeRequest(undefined,{signal:controller.signal}),testEnv());await start.promise;if(cancel)controller.abort();
  const response=await r;ok(response.status===(cancel?499:408),'bounded '+(cancel?'cancel':'parse deadline')+' response');
  await check(w,makeRequest(),'isolate_quarantined',503);wait.resolve();await sleep(1);ok((await w.fetch(makeRequest(),testEnv())).status===503,'post-response late settlement cannot reopen isolate '+cancel);
  ok(runs===1,'no new parser work after unresolved response '+cancel);
 }
 const pre=new AbortController();pre.abort();await check(base(),makeRequest(undefined,{signal:pre.signal}),'request_cancelled',499);
 const slowInit=deferred(),initEntered=deferred();let initCalls=0;
 worker=createCandidate({fixtures:fixedFixtures,now:()=>BASE,parseDeadlineMs:15,loadParser:async()=>{initCalls++;initEntered.resolve();await slowInit.promise;return async()=>structuredClone(GOOD);}});
 const init=worker.fetch(makeRequest(),testEnv());await initEntered.promise;ok((await init).status===408,'initialization deadline bounded');await check(worker,makeRequest(),'isolate_quarantined',503);slowInit.resolve();await sleep(1);ok((await worker.fetch(makeRequest(),testEnv())).status===503,'late initialization settlement cannot reopen isolate');ok(initCalls===1,'no subsequent initialization after unresolved response');
 const delayedCancel=deferred();let bodyCanceled=false;
 const stalled=new ReadableStream({pull(){return new Promise(()=>{});},cancel(){bodyCanceled=true;return delayedCancel.promise;}},{highWaterMark:0});
 worker=createCandidate({fixtures:fixedFixtures,now:()=>BASE,bodyDeadlineMs:15,cleanupDeadlineMs:5,loadParser:async()=>{throw Error('DO-NOT-LEAK-NO-PARSER');}});
 await check(worker,makeRequest(null,{raw:stalled}),'body_deadline_exceeded',408);ok(bodyCanceled,'body cancellation requested');await check(worker,makeRequest(),'isolate_quarantined',503);delayedCancel.resolve();await sleep(1);await check(worker,makeRequest(null,{raw:'{}'}),'isolate_quarantined',503);
 const cancelFailed=chunked([encoder.encode(' '.repeat(129))],()=>{throw Error('DO-NOT-LEAK-CANCEL');});
 worker=base();await check(worker,makeRequest(null,{raw:cancelFailed}),'input_too_large',413);await check(worker,makeRequest(),'isolate_quarantined',503);
 let time=BASE;const expire=deferred(),expiryEntered=deferred();
 worker=createCandidate({fixtures:fixedFixtures,now:()=>time,loadParser:async()=>async()=>{expiryEntered.resolve();await expire.promise;return structuredClone(GOOD);}});
 const expires=worker.fetch(makeRequest(),testEnv());await expiryEntered.promise;time=BASE+600001;expire.resolve();const expiredResponse=await expires;ok(expiredResponse.status===503&&(await expiredResponse.json()).error==='authorization_window_expired','expiry during parse discards successful result');
 const logs=[];const original={log:console.log,warn:console.warn,error:console.error};
 for(const method of Object.keys(original))console[method]=(...args)=>logs.push(args.join(' '));
 try{const w=createCandidate({fixtures:fixedFixtures,now:()=>BASE,loadParser:async()=>async()=>{throw Error('DO-NOT-LEAK');}});await w.fetch(makeRequest(),testEnv());}finally{Object.assign(console,original);}
 ok(logs.length===0,'interface emits no request/credential/parser-error logs');
 return {checks:labels.length,passed:labels.length,failed:0,labels};
}

export async function runActualWorkerSuite(worker){
 const labels=[];const ok=(v,label)=>{if(!v)throw Error('FAILED actual '+label);labels.push(label);};
 const env=testEnv(Date.now());let fetchCalls=0;const oldFetch=globalThis.fetch;
 globalThis.fetch=()=>{fetchCalls++;throw Error('No outbound fetch permitted');};
 try{
  const missing=await worker.fetch(makeRequest(),{});ok(missing.status===503,'default missing env fails closed');
  for(const f of fixedFixtures){
   const response=await worker.fetch(makeRequest({fixture_id:f.fixture_id}),env);const body=await response.json();
   ok(response.status===200&&body.success===true&&body.outcome==='exact_fixture_match'&&body.page_count===1,'exact fixture '+f.fixture_id);
   ok(body.coverage.assessment==='not_a_completeness_proof','qualified '+f.fixture_id);
   ok(!JSON.stringify(body).includes(f.expectedPages[0].text)&&!('pages'in body),'metadata only '+f.fixture_id);
   if(f.encrypted)for(const mode of ['wrong','missing']){
    const response=await worker.fetch(makeRequest({fixture_id:f.fixture_id,password_mode:mode}),env);const body=await response.json();ok(response.status===200&&body.outcome==='expected_password_error'&&body.success===false,'expected password '+mode+' '+f.fixture_id);
   }
  }
  ok((await worker.fetch(makeRequest(),env)).status===200,'actual password cleanup permits next request');
  ok(fetchCalls===0,'zero observed global fetch calls');
  return {checks:labels.length,passed:labels.length,failed:0,global_fetch_calls:fetchCalls,labels};
 }finally{globalThis.fetch=oldFetch;}
}
