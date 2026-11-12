import {timingSafeEqual} from 'node:crypto';

const VERSION='6.2.108';
const BODY_BYTES=128;
const LIMITS=Object.freeze({pages:2,characters:2000});
const CMAPS=Object.freeze(['Adobe-GB1-UCS2.bcmap','UniGB-UCS2-H.bcmap']);
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'}});
const deny=(error,status,reason)=>json(reason?{error,reason}:{error},status);
const hash=async bytes=>new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));
const hex=bytes=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
const denseArray=value=>Array.isArray(value)&&Array.from({length:value.length},(_,i)=>Object.hasOwn(value,i)).every(Boolean);
const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const exactKeys=(value,keys)=>record(value)&&Object.keys(value).length===keys.length&&keys.every(k=>Object.hasOwn(value,k));
class GateError extends Error {
 constructor(code,status){super('Synthetic request rejected');this.name='GateError';this.code=code;this.status=status;}
}

// Only the trusted host can instantiate this factory with test dependencies.
// The standalone production default export never exposes this function or its options.
export function createCandidate({fixtures,loadParser,now=()=>Date.now(),bodyDeadlineMs=1500,parseDeadlineMs=5000,cleanupDeadlineMs=100}={}) {
 if(!Array.isArray(fixtures)||typeof loadParser!=='function'||typeof now!=='function')throw new Error('Invalid host configuration');
 for(const v of [bodyDeadlineMs,parseDeadlineMs,cleanupDeadlineMs])if(!Number.isSafeInteger(v)||v<1||v>60000)throw new Error('Invalid host deadline');
 let occupied=false,quarantined=false;
 // Accepted request lifecycles count underlying operations, not race winners.
 // Finishing with unresolved work permanently quarantines this instance.
 // No hosted post-response execution or cleanup/recovery guarantee is assumed.
 const lifecycle=()=>{
  let pending=0,responded=false;
  const release=()=>{if(responded&&pending===0&&!quarantined)occupied=false;};
  return {
   track(operation,kind='ordinary'){
    pending++;
    const promise=Promise.resolve().then(operation);
    promise.then(()=>{pending--;release();},error=>{
     if(kind==='cleanup'||kind==='loader'||(kind==='parser'&&!verifiedCleanError(error)))quarantined=true;
     pending--;release();
    });
    return promise;
   },
   finish(){responded=true;if(pending>0)quarantined=true;release();}
  };
 };
 const verifiedCleanError=error=>
  (error?.name==='PasswordException'&&[1,2].includes(error.code))||
  (error?.name==='TextCoverageError'&&['resource_failure','invalid_cmap','font_translation'].includes(error.code))||
  (error?.name==='ExtractionLimitError'&&['input_bytes','invalid_limits','page_limit','text_limit'].includes(error.code))||
  (error?.name==='PdfExtractionError'&&['malformed_pdf','parser_error'].includes(error.code))||error?.name==='AbortError';
 const futureExpiry=env=>{
  const token=env?.BENCHMARK_ACCESS_TOKEN,expiry=env?.BENCHMARK_EXPIRES_AT;
  if(typeof token!=='string'||token.length<32||token.length>512||!/^[\x21-\x7e]+$/.test(token)||typeof expiry!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(expiry))return null;
  const timestamp=Date.parse(expiry);
  if(!Number.isFinite(timestamp)||new Date(timestamp).toISOString()!==expiry.replace('Z','.000Z')||timestamp<=now()||timestamp-now()>30*60*1000)return null;
  return {token,timestamp};
 };
 const expired=auth=>auth.timestamp<=now();
 const failIfExpired=auth=>{if(expired(auth))throw new GateError('authorization_window_expired',503);};
 const makeDeadline=(signal,duration,code,life)=>{
  let timer,stopReason;
  const deadlineAt=now()+duration;
  const controller=new AbortController();
  let reject;
  const stopped=new Promise((_resolve,r)=>{reject=r;});void stopped.catch(()=>{});
  const stop=reason=>{
   if(stopReason)return;
   stopReason=reason;
   controller.abort();reject(reason);
  };
  const aborted=()=>stop(new GateError('request_cancelled',499));
  signal?.addEventListener('abort',aborted,{once:true});
  if(signal?.aborted)aborted();
  timer=setTimeout(()=>stop(new GateError(code,408)),duration);
  return {
   signal:controller.signal,
   run(operation,kind='ordinary'){this.check();return Promise.race([life.track(operation,kind),stopped]);},
   check(){if(!stopReason&&now()>=deadlineAt)stop(new GateError(code,408));if(stopReason)throw stopReason;},
   close(){clearTimeout(timer);signal?.removeEventListener('abort',aborted);}
  };
 };
 async function readBody(request,life){
  const gate=makeDeadline(request.signal,bodyDeadlineMs,'body_deadline_exceeded',life);
  let reader,done=false;
  try{
   gate.check();reader=request.body?.getReader();
   if(!reader)throw new GateError('invalid_input',400);
   const bytes=new Uint8Array(BODY_BYTES);let length=0,reads=0;
   while(true){
    if(++reads>BODY_BYTES+1)throw new GateError('invalid_input',400);
    const part=await gate.run(()=>reader.read());gate.check();
    if(part.done){done=true;break;}
    if(!(part.value instanceof Uint8Array)||part.value.byteLength===0)throw new GateError('invalid_input',400);
    if(length+part.value.byteLength>BODY_BYTES)throw new GateError('input_too_large',413);
    bytes.set(part.value,length);length+=part.value.byteLength;
   }
   const declared=request.headers.get('content-length');
   if(declared!==null&&Number(declared)!==length)throw new GateError('content_length_mismatch',400);
   try{return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes.subarray(0,length));}
   catch{throw new GateError('invalid_utf8',400);}
  }catch(error){
   if(reader&&!done){
    // A bounded wait is not a claim that the source has stopped. If uncertain,
    // quarantine if still unresolved when the response finishes; failures also quarantine.
    let timer;
    try{
     await Promise.race([life.track(async()=>{await reader.cancel();reader.releaseLock();},'cleanup'),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Cancellation unsettled')),cleanupDeadlineMs);})]);
    }catch{/* The tracked cleanup outcome owns quarantine/release. */}
    finally{clearTimeout(timer);}
   }
   if(error instanceof GateError)throw error;
   throw new GateError('invalid_input',400);
  }finally{
   gate.close();
   if(reader&&done)try{reader.releaseLock();}catch{quarantined=true;throw new GateError('body_cleanup_failed',500);}
  }
 }
 function parseInput(text){
  // A deliberately narrow JSON object schema: literal ASCII keys/string enums,
  // no escapes, nested values, duplicate keys, unknown fields or BOM.
  const whitespace='[\\x20\\x09\\x0a\\x0d]*';
  const property='"(?:fixture_id|password_mode)"'+whitespace+':'+whitespace+'"[A-Za-z0-9_.-]+"';
  if(!new RegExp('^'+whitespace+'\\{'+whitespace+property+'(?:'+whitespace+','+whitespace+property+')?'+whitespace+'\\}'+whitespace+'$').test(text))throw new GateError('invalid_input',400);
  let value;try{value=JSON.parse(text);}catch{throw new GateError('invalid_input',400);}
  if(!record(value)||!Object.hasOwn(value,'fixture_id')||Object.keys(value).some(k=>!['fixture_id','password_mode'].includes(k)))throw new GateError('invalid_input',400);
  const keys=[...text.matchAll(/"(fixture_id|password_mode)"\s*:/g)].map(m=>m[1]);
  if(new Set(keys).size!==keys.length)throw new GateError('invalid_input',400);
  const mode=value.password_mode??'correct';
  if(!['correct','wrong','missing'].includes(mode))throw new GateError('invalid_input',400);
  const fixture=fixtures.find(f=>f.fixture_id===value.fixture_id);
  if(!fixture)throw new GateError('invalid_fixture',400);
  if(!fixture.encrypted&&mode!=='correct')throw new GateError('invalid_password_mode',400);
  return {fixture,mode};
 }
 function validateResult(result,fixture){
  if(!record(result)||!denseArray(result.pages)||result.pages.length!==fixture.expectedPages.length||result.pages.some((p,i)=>!exactKeys(p,['page','text'])||p.page!==fixture.expectedPages[i].page||p.text!==fixture.expectedPages[i].text))throw new GateError('fixture_text_mismatch',422);
  if(result.text_status!=='text_found')throw new GateError('coverage_assessment_invalid',422);
  const c=result.coverage;
  if(!exactKeys(c,['assessment','status','requested_resources','delivered_bytes','cmap_names','standard_font_fallback_count'])||c.assessment!=='not_a_completeness_proof'||!['standard_font_fallback_used','no_detected_resource_failure'].includes(c.status)||!Number.isSafeInteger(c.requested_resources)||c.requested_resources<0||c.requested_resources>32||!Number.isSafeInteger(c.delivered_bytes)||c.delivered_bytes<0||c.delivered_bytes>1048576||!Number.isSafeInteger(c.standard_font_fallback_count)||c.standard_font_fallback_count<0||c.standard_font_fallback_count>14||!denseArray(c.cmap_names)||c.cmap_names.some(n=>!CMAPS.includes(n))||new Set(c.cmap_names).size!==c.cmap_names.length||c.status!==(c.standard_font_fallback_count?'standard_font_fallback_used':'no_detected_resource_failure'))throw new GateError('coverage_assessment_invalid',422);
  if(fixture.fixture_id==='fixture-baseline.pdf'&&(JSON.stringify(c.cmap_names)!==JSON.stringify(CMAPS)||c.delivered_bytes!==77340))throw new GateError('coverage_assessment_invalid',422);
  // Rebuild metadata from a fixed list; no parser text, arbitrary properties,
  // exception details or supplied request values are copied to a response.
  return {assessment:'not_a_completeness_proof',status:c.status,requested_resources:c.requested_resources,delivered_bytes:c.delivered_bytes,cmap_names:[...c.cmap_names],standard_font_fallback_count:c.standard_font_fallback_count};
 }
 const safeParserError=error=>{
  if(error?.name==='TextCoverageError')return deny('text_coverage_failed',422,['resource_failure','invalid_cmap','font_translation'].includes(error.code)?error.code:'unknown_coverage_failure');
  if(error?.name==='ExtractionLimitError')return deny('extraction_limit_exceeded',422,['input_bytes','invalid_limits','page_limit','text_limit'].includes(error.code)?error.code:'unknown_limit');
  if(error?.name==='PdfExtractionError')return deny('pdf_extraction_failed',500,['malformed_pdf','parser_error','cleanup_timeout','cleanup_failed'].includes(error.code)?error.code:'unknown_parser_failure');
  if(error?.name==='PasswordException')return deny('unexpected_password_error',500);
  if(error?.name==='AbortError')return deny('parser_aborted',500);
  return deny('synthetic_parse_failed',500);
 };
 return Object.freeze({async fetch(request,env){
  let auth;
  try{auth=futureExpiry(env);}catch{return deny('authorization_not_configured_or_expired',503);}
  if(!auth)return deny('authorization_not_configured_or_expired',503);
  const authorization=request.headers.get('authorization');
  if(!authorization||authorization.length>519)return deny('unauthorized',401);
  try{
   const encoder=new TextEncoder();
   const [a,b]=await Promise.all([hash(encoder.encode(authorization)),hash(encoder.encode('Bearer '+auth.token))]);
   if(!timingSafeEqual(a,b))return deny('unauthorized',401);
  }catch{return deny('unauthorized',401);}
  if(expired(auth))return deny('authorization_window_expired',503);
  const url=new URL(request.url);
  if(url.pathname!=='/benchmark'||url.search||url.hash)return deny('invalid_route',404);
  if(request.method!=='POST')return deny('method_not_allowed',405);
  if(request.headers.get('content-type')!=='application/json')return deny('unsupported_media_type',415);
  if(request.headers.has('content-encoding'))return deny('invalid_encoding',400);
  const declared=request.headers.get('content-length');
  if(declared!==null&&(!/^(0|[1-9][0-9]{0,8})$/.test(declared)))return deny('invalid_content_length',400);
  if(declared!==null&&Number(declared)>BODY_BYTES)return deny('input_too_large',413);
  if(quarantined)return deny('isolate_quarantined',503);
  if(occupied)return deny('busy',429);
  occupied=true;
  const life=lifecycle();
  try{
   const text=await readBody(request,life);failIfExpired(auth);
   const {fixture,mode}=parseInput(text);
   if(request.signal?.aborted)throw new GateError('request_cancelled',499);
   // Validate both immutable size and hash before the loader can initialize.
   if(!Number.isSafeInteger(fixture.bytes)||fixture.bytes<1||fixture.bytes>2097152||typeof fixture.data!=='string'||fixture.data.length!==4*Math.ceil(fixture.bytes/3))throw new GateError('fixture_integrity_failed',500);
   let bytes;try{bytes=Uint8Array.from(atob(fixture.data),c=>c.charCodeAt(0));}catch{throw new GateError('fixture_integrity_failed',500);}
   if(bytes.byteLength!==fixture.bytes||hex(await hash(bytes))!==fixture.sha256)throw new GateError('fixture_integrity_failed',500);
   failIfExpired(auth);
   if(request.signal?.aborted)throw new GateError('request_cancelled',499);
   const gate=makeDeadline(request.signal,parseDeadlineMs,'parse_deadline_exceeded',life);
   let parserStarted=false;
   try{
    gate.check();parserStarted=true;
    const extract=await gate.run(()=>loadParser(),'loader');gate.check();failIfExpired(auth);
    if(typeof extract!=='function')throw new Error('Invalid parser');
    let result;
    try{
     const password=fixture.encrypted?(mode==='correct'?'SYNTHETIC-ONLY-DO-NOT-USE':mode==='wrong'?'PUBLIC-INTENTIONALLY-WRONG':undefined):undefined;
     result=await gate.run(()=>extract(bytes,password,LIMITS,{signal:gate.signal}),'parser');failIfExpired(auth);gate.check();
    }catch(error){
     // This isolated adapter makes cleanup failure override every primary error.
     // The tracked underlying promise, not this race, owns slot/quarantine state.
     failIfExpired(auth);gate.check();
     if(error?.name==='PasswordException'&&error.code===(mode==='missing'?1:mode==='wrong'?2:-1))return json({schema:'synthetic_protected_candidate_v1',parser_version:VERSION,fixture_id:fixture.fixture_id,sha256:fixture.sha256,bytes:fixture.bytes,password_mode:mode,success:false,outcome:'expected_password_error',page_count:0,text_status:'not_evaluated',coverage:{assessment:'not_a_completeness_proof',status:'not_evaluated'}});
     throw error;
    }
    failIfExpired(auth);gate.check();
    if(mode!=='correct')throw new GateError('unexpected_password_acceptance',500);
    const coverage=validateResult(result,fixture);
    failIfExpired(auth);gate.check();
    return json({schema:'synthetic_protected_candidate_v1',parser_version:VERSION,fixture_id:fixture.fixture_id,sha256:fixture.sha256,bytes:fixture.bytes,password_mode:mode,success:true,outcome:'exact_fixture_match',page_count:result.pages.length,text_status:'text_found',coverage});
   }catch(error){
    if(parserStarted&&!(error instanceof GateError)&&!verifiedCleanError(error))quarantined=true;
    if(error instanceof GateError)throw error;
    return safeParserError(error);
   }finally{gate.close();}
  }catch(error){
   if(error instanceof GateError)return deny(error.code,error.status);
   return deny('request_failed',500);
  }finally{
   // Timers bound response waits, not CPU/memory or teardown. Underlying work
   // must settle before response completion to permit release. Unresolved work
   // or cleanup failure permanently quarantines, even if it later settles locally.
   life.finish();
  }
 }});
}
