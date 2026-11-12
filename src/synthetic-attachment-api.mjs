// Local-only normalized attachment API. Not a Gmail/iCloud response decoder,
// deployed route, authentication service, or persistent password store.
import {fixedFixtures} from './fixed-fixtures.mjs';
import {findLiteralMatches} from './page-citations.mjs';

const MAX_BODY = 32768;
const limits = Object.freeze({pages:2, characters:2000});
const exact = (v, keys) => v !== null && typeof v === 'object' && !Array.isArray(v) &&
  Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const fields = ['source_ref','filename','data_base64','sha256','password_profile','query'];
const sourceFields = ['source_ref','provider','account_ref','message_id','attachment_id','filename','sha256'];
const identifier = v => typeof v === 'string' && /^synthetic-[A-Za-z0-9._-]{1,96}$/.test(v);
const chars = v => Array.from(v);
const validQuery = v => typeof v === 'string' && v.trim().length > 0 && chars(v).length <= 80 &&
  !/[\u0000-\u001f\u007f]/u.test(v) && !chars(v).some(c => c.length === 1 && /[\ud800-\udfff]/u.test(c));
const reply = (value, status=200) => new Response(JSON.stringify(value), {
  status, headers:{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'}
});
class InputError extends Error {
  constructor(code, status=400) { super('Synthetic attachment rejected'); this.code=code; this.status=status; }
}
const reject = (code, status) => { throw new InputError(code, status); };

async function readInput(request) {
  if(request.headers.get('content-type') !== 'application/json') reject('unsupported_media_type',415);
  if(request.headers.has('content-encoding')) reject('invalid_encoding');
  const declared = request.headers.get('content-length');
  if(declared !== null && (!/^(0|[1-9][0-9]{0,8})$/.test(declared) || Number(declared)>MAX_BODY)) reject('input_too_large',413);
  const reader=request.body?.getReader(); if(!reader) reject('invalid_input');
  const bytes=new Uint8Array(MAX_BODY);let n=0,done=false,reads=0;
  try {
    while(true) {
      if(request.signal.aborted) reject('request_cancelled',499);
      const part=await reader.read();
      // A pending read needs the source to settle; abort is not a hard stop.
      // Recheck before parsing/EOF so cancellation cannot become invalid JSON.
      if(request.signal.aborted) reject('request_cancelled',499);
      if(part.done) {done=true;break;}
      if(++reads>MAX_BODY || !(part.value instanceof Uint8Array) || !part.value.length) reject('invalid_input');
      if(n+part.value.length>MAX_BODY) reject('input_too_large',413);
      bytes.set(part.value,n);n+=part.value.length;
    }
    if(declared !== null && Number(declared)!==n) reject('content_length_mismatch');
    let text,value;
    try {text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes.subarray(0,n));value=JSON.parse(text);}
    catch {reject('invalid_input');}
    if(!exact(value,fields) || !validQuery(value.query)) reject('invalid_input');
    // This flat contract rejects duplicate or escaped field names. JSON.parse
    // alone silently accepts duplicate keys; values may contain normal escapes.
    const keys=[...text.matchAll(/"((?:[^"\\]|\\.)*)"\s*:/g)].map(m=>m[1]);
    if(keys.length!==fields.length || new Set(keys).size!==fields.length || keys.some(k=>!fields.includes(k))) reject('invalid_input');
    return value;
  } finally {
    try {if(!done) await reader.cancel();} finally {reader.releaseLock();}
  }
}


export function createSyntheticAttachmentApi({sources,resolvePassword,loadParser}={}) {
  if(!Array.isArray(sources) || !sources.length || typeof resolvePassword!=='function' || typeof loadParser!=='function') throw new Error('Invalid synthetic host configuration');
  const selected=new Map();
  for(const s of sources) {
    if(!exact(s,sourceFields) || !['gmail','icloud'].includes(s.provider) ||
      !['source_ref','account_ref','message_id'].every(k=>identifier(s[k])) ||
      !(s.attachment_id===null || identifier(s.attachment_id)) ||
      !fixedFixtures.some(f=>f.fixture_id===s.filename && f.sha256===s.sha256) || selected.has(s.source_ref)) throw new Error('Invalid synthetic source');
    selected.set(s.source_ref,Object.freeze({...s}));
  }
  let busy=false;
  return Object.freeze({async fetch(request) {
    const url=new URL(request.url);
    if(url.pathname!=='/v1/synthetic/search' || url.search || url.hash) return reply({error:'invalid_route'},404);
    if(request.method!=='POST') return reply({error:'method_not_allowed'},405);
    if(busy) return reply({error:'busy'},429);
    busy=true;
    try {
      const value=await readInput(request);
      const source=selected.get(value.source_ref);
      if(!source) reject('source_not_selected',403);
      if(value.filename!==source.filename || value.sha256!==source.sha256) reject('source_mismatch',422);
      const fixture=fixedFixtures.find(f=>f.fixture_id===source.filename && f.sha256===source.sha256);
      if(typeof value.data_base64!=='string' || value.data_base64.length!==4*Math.ceil(fixture.bytes/3) ||
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value.data_base64)) reject('invalid_attachment',422);
      const decoded=atob(value.data_base64);
      if(btoa(decoded)!==value.data_base64) reject('invalid_attachment',422);
      const bytes=Uint8Array.from(decoded,c=>c.charCodeAt(0));
      const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
      if(bytes.length!==fixture.bytes || digest!==fixture.sha256) reject('attachment_integrity_failed',422);
      if(fixture.encrypted ? value.password_profile!=='synthetic-fixture' : value.password_profile!==null) reject('invalid_password_profile',422);
      if(request.signal.aborted) reject('request_cancelled',499);
      // One trusted-host resolver call per encrypted request; no password cache.
      let password;
      try {
        if(fixture.encrypted) {
          password=await resolvePassword('synthetic-fixture',Object.freeze({...source}));
          if(password===undefined || password===null) reject('password_profile_unavailable',422);
          if(typeof password!=='string' || password.length>256) reject('invalid_password_profile',422);
        }
        if(request.signal.aborted) reject('request_cancelled',499);
        const extract=await loadParser();
        if(request.signal.aborted) reject('request_cancelled',499);
        const result=await extract(bytes,password,limits,{signal:request.signal});
        if(request.signal.aborted) reject('request_cancelled',499);
        // Exact known oracle: this exercise must never turn altered/incomplete
        // output into a source citation. This is not a generic completeness test.
        if(!Array.isArray(result?.pages) || result.pages.length!==fixture.expectedPages.length ||
          result.pages.some((p,i)=>!exact(p,['page','text']) || p.page!==fixture.expectedPages[i].page || p.text!==fixture.expectedPages[i].text) ||
          result.text_status!=='text_found' || result.coverage?.assessment!=='not_a_completeness_proof') reject('fixture_text_mismatch',422);
        const found=findLiteralMatches(result.pages,value.query,source,digest);
        return reply({schema:'synthetic_attachment_search_v1',parser_version:'6.2.108',
          status:found.matches.length?'matches_found':'no_match',source:{...source},sha256:digest,
          page_count:result.pages.length,search:{mode:'literal_case_sensitive',range_unit:'unicode_codepoint',truncated:found.truncated},
          coverage:{assessment:'not_a_completeness_proof'},matches:found.matches});
      } finally {password=undefined;bytes.fill(0);}
    } catch(error) {
      if(error instanceof InputError) return reply({error:error.code},error.status);
      if(request.signal.aborted || error?.name==='AbortError') return reply({error:'request_cancelled'},499);
      if(error?.name==='PasswordException' && [1,2].includes(error.code)) return reply({error:error.code===1?'password_required':'incorrect_password'},422);
      if(error?.name==='TextCoverageError') return reply({error:'text_coverage_failed'},422);
      if(error?.name==='ExtractionLimitError') return reply({error:'extraction_limit_exceeded'},422);
      return reply({error:'extraction_failed'},500);
    } finally {busy=false;}
  }});
}
