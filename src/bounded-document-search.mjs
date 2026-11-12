// Unpublished, host-only functional candidate. No mail client, HTTP route, secret
// store or production authorization. Exercise with synthetic documents only.
import {findLiteralMatches} from './page-citations.mjs';

export const DOCUMENT_LIMITS=Object.freeze({max_bytes:2097152,max_pages:20,max_text_utf16:50000,max_query_codepoints:80,max_stream_chunks:4096});
const HARD=Object.freeze({max_bytes:2097152,max_pages:64,max_text_utf16:100000});
const exact=(v,keys)=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const id=v=>typeof v==='string'&&v.length>0&&v.length<=512&&!/[\u0000-\u001f\u007f]/u.test(v);
const sourceKeys=['source_ref','provider','account_ref','message_id','attachment_id','filename','sha256'];
const codes=new Set(['invalid_limits','invalid_selection','invalid_query','invalid_profile','input_too_large','invalid_stream','stream_limit','size_mismatch','integrity_failed','not_pdf',
  'profile_unavailable','password_required','incorrect_password','page_limit','text_limit','resource_failure','malformed_pdf','parser_failed','invalid_parser_result',
  'request_cancelled','cleanup_failed','busy']);
const wipe=Function.prototype.call.bind(Uint8Array.prototype.fill);
export class DocumentSearchError extends Error {
  constructor(code){super('Selected document search failed');this.name='DocumentSearchError';this.code=codes.has(code)?code:'parser_failed';}
}
const fail=code=>{throw new DocumentSearchError(code);};
const hash=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
const validQuery=q=>typeof q==='string'&&q.trim().length>0&&Array.from(q).length<=80&&!/[\u0000-\u001f\u007f]/u.test(q)&&
  !Array.from(q).some(c=>c.length===1&&/[\ud800-\udfff]/u.test(c));

export function createBoundedDocumentSearch({loadParser,resolvePassword,limits={}}={}) {
  if(typeof loadParser!=='function'||typeof resolvePassword!=='function')throw new Error('Explicit host parser and password resolver required');
  if(!limits||typeof limits!=='object'||Array.isArray(limits)||Object.keys(limits).some(k=>!Object.hasOwn(HARD,k)))fail('invalid_limits');
  const policy=Object.freeze({...DOCUMENT_LIMITS,...limits});
  for(const key of Object.keys(HARD))if(!Number.isSafeInteger(policy[key])||policy[key]<(key==='max_bytes'?5:1)||policy[key]>HARD[key])fail('invalid_limits');
  const prepareSelection=input=>{
    if(!exact(input,['source','size_bytes','query','password_profile'])||!exact(input.source,sourceKeys))fail('invalid_selection');
    const s=input.source;
    if(!sourceKeys.filter(k=>k!=='attachment_id'&&k!=='sha256').every(k=>id(s[k]))||!['gmail','icloud'].includes(s.provider)||
      !(s.attachment_id===null&&s.provider==='gmail'||id(s.attachment_id))||!s.filename.toLowerCase().endsWith('.pdf')||/[\\/]/.test(s.filename)||
      !(s.sha256===null||typeof s.sha256==='string'&&/^[0-9a-f]{64}$/.test(s.sha256))||!Number.isSafeInteger(input.size_bytes)||input.size_bytes<5)fail('invalid_selection');
    if(input.size_bytes>policy.max_bytes)fail('input_too_large');
    if(!validQuery(input.query))fail('invalid_query');
    if(input.password_profile!==null&&!(typeof input.password_profile==='string'&&/^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/.test(input.password_profile)))fail('invalid_profile');
    return Object.freeze({source:Object.freeze({...s}),size_bytes:input.size_bytes,query:input.query,password_profile:input.password_profile});
  };
  let busy=false;
  return Object.freeze({limits:policy,prepareSelection,async search(input,{signal}={}) {
    if(busy)fail('busy');
    if(!exact(input,['source','size_bytes','stream','query','password_profile']))fail('invalid_selection');
    const selection=prepareSelection({source:input.source,size_bytes:input.size_bytes,query:input.query,password_profile:input.password_profile});
    let source=selection.source;
    const hadExpectedHash=source.sha256!==null,expected=selection.size_bytes,query=selection.query,profile=selection.password_profile,stream=input.stream;
    const check=()=>{if(signal?.aborted)fail('request_cancelled');};
    busy=true;let bytes,password,stage='invalid_stream';
    try {
      check();if(!stream||typeof stream[Symbol.asyncIterator]!=='function')fail('invalid_stream');
      bytes=new Uint8Array(expected);let offset=0,chunks=0;
      for await(const chunk of stream) {
        check();if(!(chunk instanceof Uint8Array)||chunk.length===0)fail('invalid_stream');
        if(++chunks>policy.max_stream_chunks)fail('stream_limit');
        if(offset+chunk.length>expected)fail('size_mismatch');bytes.set(chunk,offset);offset+=chunk.length;
      }
      check();if(offset!==expected)fail('size_mismatch');
      stage='integrity_failed';const sha256=await hash(bytes);check();if(hadExpectedHash&&sha256!==source.sha256)fail('integrity_failed');
      source=Object.freeze({...source,sha256});
      if(bytes[0]!==37||bytes[1]!==80||bytes[2]!==68||bytes[3]!==70||bytes[4]!==45)fail('not_pdf');
      // A missing profile is not silently guessed or cached. Plain documents
      // should use null; encrypted documents without one report password_required.
      if(profile!==null){
        stage='profile_unavailable';password=await resolvePassword(profile,source);check();
        if(password===undefined||password===null)fail('profile_unavailable');
        if(typeof password!=='string'||password.length>256)fail('invalid_profile');
      }
      stage='parser_failed';const extract=await loadParser();check();
      const result=await extract(bytes,password,{pages:policy.max_pages,characters:policy.max_text_utf16},{signal});check();
      if(!Array.isArray(result?.pages)||!result.pages.length||result.pages.length>policy.max_pages||
        result.pages.some((p,i)=>!exact(p,['page','text'])||p.page!==i+1||typeof p.text!=='string')||
        result.pages.reduce((n,p)=>n+p.text.length,0)>policy.max_text_utf16||
        result.coverage?.assessment!=='not_a_completeness_proof'||!['standard_font_fallback_used','no_detected_resource_failure'].includes(result.coverage.status)||
        !['text_found','no_extractable_text'].includes(result.text_status)||
        result.pages.some(p=>p.text.length>0)!==(result.text_status==='text_found'))fail('invalid_parser_result');
      const found=findLiteralMatches(result.pages,query,source,sha256);
      return {schema:'bounded_document_search_candidate_v1',status:result.text_status==='no_extractable_text'?'no_extractable_text':found.matches.length?'matches_found':'no_match',
        source:{...source},sha256,integrity:{comparison:hadExpectedHash?'matched_expected':'computed_without_prior_hash'},page_count:result.pages.length,limits:{...policy},
        search:{mode:'literal_case_sensitive',range_unit:'unicode_codepoint',truncated:found.truncated},
        coverage:{assessment:'not_a_completeness_proof',status:result.coverage.status==='standard_font_fallback_used'?'standard_font_fallback_used':'no_detected_resource_failure'},matches:found.matches};
    } catch(error) {
      if(signal?.aborted)fail('request_cancelled');
      let code,name,detail;try{if(error instanceof DocumentSearchError)code=error.code;name=error?.name;detail=error?.code;}catch{}
      if(codes.has(code))throw new DocumentSearchError(code);
      if(name==='AbortError')fail('request_cancelled');
      if(stage==='parser_failed'){
        if(name==='PasswordException'&&(detail===1||detail===2))fail(detail===1?'password_required':'incorrect_password');
        if(name==='ExtractionLimitError'&&['page_limit','text_limit'].includes(detail))fail(detail);
        if(name==='TextCoverageError')fail('resource_failure');
        if(name==='PdfExtractionError'&&detail==='malformed_pdf')fail('malformed_pdf');
        if(name==='PdfExtractionError'&&['cleanup_failed','cleanup_timeout'].includes(detail))fail('cleanup_failed');
      }
      throw new DocumentSearchError(stage);
    } finally {
      password=undefined;
      try{if(bytes)wipe(bytes,0);}catch{throw new DocumentSearchError('cleanup_failed');}
      finally{busy=false;}
    }
  }});
}
