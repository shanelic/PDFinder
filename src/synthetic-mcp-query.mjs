import {isDeepStrictEqual} from 'node:util';
import {fixedFixtures} from './fixed-fixtures.mjs';
import {findLiteralMatches} from './page-citations.mjs';
import {DOCUMENT_LIMITS} from './bounded-document-search.mjs';
// OFFLINE decoded-message adapter ONLY, not a complete MCP server or transport.
// No server/discover, HTTP MCP headers, registration, session/auth implementation
// or legacy negotiation. Client _meta is self-reported, never identity evidence.
const VERSION='2026-07-28',NAME='search_synthetic_selected_pdf';
const record=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const exact=(v,keys)=>record(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const protocol=(id,code,message,data)=>({jsonrpc:'2.0',...(id===null?{}:{id}),error:{code,message,...(data?{data}:{})}});
const toolResult=(id,value,isError)=>({jsonrpc:'2.0',id,result:{resultType:'complete',content:[{type:'text',text:JSON.stringify(value)}],structuredContent:value,isError}});
const failTool=id=>toolResult(id,{error:'invalid_request'},true);
const PIN='88bcd7d2be5ff65e024d6b3a5964da2a0d10b1f36cbb2616abfc60556a8fe47c';
const synthetic=v=>typeof v==='string'&&/^(?:opaque-)?synthetic-[A-Za-z0-9._-]{1,80}$/.test(v);
const HTTP_ERRORS={400:['invalid_request'],401:['authentication_failed'],403:['origin_rejected'],404:['route_not_found','selection_unavailable'],405:['method_not_allowed'],413:['body_too_large'],415:['unsupported_media_type'],422:['profile_unavailable','document_processing_failed'],499:['request_cancelled'],500:['query_failed','document_processing_failed'],502:['mail_processing_failed']};
function safeSuccess(value,query){
 const source=value?.source;
 if(!exact(source,['source_ref','provider','account_ref','message_id','attachment_id','filename','sha256'])||
  !synthetic(source.source_ref)||!synthetic(source.account_ref)||!synthetic(source.message_id)||!['gmail','icloud'].includes(source.provider)||
  (source.provider==='gmail'?source.attachment_id!==null:typeof source.attachment_id!=='string'||!/^\d+(?:\.\d+)*$/.test(source.attachment_id)||source.attachment_id.length>32)||source.filename!=='AES-256.pdf'||source.sha256!==PIN)return null;
 const status=value?.coverage?.status;if(!['standard_font_fallback_used','no_detected_resource_failure'].includes(status))return null;
 const found=findLiteralMatches(fixedFixtures.find(f=>f.fixture_id==='AES-256.pdf').expectedPages,query,source,PIN);
 // Reconstruct the ENTIRE one-fixture response. Unknown fields, altered text,
 // citations, limits or mismatched error/success shapes never leave this boundary.
 const expected={schema:'bounded_document_search_candidate_v1',status:found.matches.length?'matches_found':'no_match',source:{...source},sha256:PIN,
  integrity:{comparison:'matched_expected'},page_count:1,limits:{...DOCUMENT_LIMITS},search:{mode:'literal_case_sensitive',range_unit:'unicode_codepoint',truncated:found.truncated},
  coverage:{assessment:'not_a_completeness_proof',status},matches:found.matches,
  transport:{route:source.provider==='gmail'?'gmail_raw':'icloud_original',identity_scope:'trusted_host_connection_not_provider_authentication_proof'}};
 return isDeepStrictEqual(value,expected)?expected:null;
}
export function createSyntheticMcpQuery({http,trustedOrigin}={}){
 let fetch;
 try{if(new URL(trustedOrigin).origin!==trustedOrigin||!trustedOrigin.startsWith('https://')||typeof http?.fetch!=='function')throw Error();fetch=http.fetch.bind(http);}catch{throw Error('Synthetic MCP host configuration invalid');}
 return Object.freeze({async handle(message,trustedContext,trustedAbortSignal){
  let input,id=null,validated=false;
  try{
   input=structuredClone(message);
   // Notifications never execute tools, including malformed notifications.
   if(record(input)&&!Object.hasOwn(input,'id'))return undefined;
   if(record(input)&&(typeof input.id==='string'||Number.isSafeInteger(input.id)))id=input.id;
   if(!record(input)||id===null||input.jsonrpc!=='2.0'||typeof input.method!=='string'||Object.keys(input).some(k=>!['jsonrpc','id','method','params'].includes(k)))return protocol(id,-32600,'Invalid Request');
   validated=true;const p=input.params,m=p?._meta;
   if(!record(p)||!record(m)||(typeof m['io.modelcontextprotocol/protocolVersion']!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(m['io.modelcontextprotocol/protocolVersion']))||!record(m['io.modelcontextprotocol/clientCapabilities']))return protocol(id,-32602,'Invalid params');
   if(m['io.modelcontextprotocol/protocolVersion']!==VERSION)return protocol(id,-32022,'Unsupported protocol version',{supported:[VERSION],requested:m['io.modelcontextprotocol/protocolVersion']});
   if(input.method==='tools/list'){
    if(Object.keys(p).some(k=>k!=='_meta'))return protocol(id,-32602,'Invalid params');
    return {jsonrpc:'2.0',id,result:{resultType:'complete',tools:[{name:NAME,description:'Search one host-authorized synthetic AES-256 PDF. No real documents or passwords.',inputSchema:{type:'object',properties:{selection_ref:{type:'string',pattern:'^(?:opaque-)?synthetic-[A-Za-z0-9._-]{1,80}$'},query:{type:'string',minLength:1,maxLength:80}},required:['selection_ref','query'],additionalProperties:false}}]}};
   }
   if(input.method!=='tools/call')return protocol(id,-32601,'Method not found');
   if(Object.keys(p).some(k=>!['_meta','name','arguments'].includes(k))||p.name!==NAME)return protocol(id,-32602,'Invalid params');
   if(Object.hasOwn(p,'arguments')&&!record(p.arguments))return protocol(id,-32602,'Invalid params');
   const a=p.arguments;
   if(!exact(a,['selection_ref','query'])||typeof a.selection_ref!=='string'||!/^(?:opaque-)?synthetic-[A-Za-z0-9._-]{1,80}$/.test(a.selection_ref)||typeof a.query!=='string'||!a.query.trim()||Array.from(a.query).length>80||/[\u0000-\u001f\u007f]/u.test(a.query)||Array.from(a.query).some(c=>c.length===1&&/[\ud800-\udfff]/u.test(c)))return failTool(id);
   if(trustedAbortSignal?.aborted)return toolResult(id,{error:'request_cancelled'},true);
   const request=new Request(trustedOrigin+'/v1/selected-mail/search',{method:'POST',headers:{origin:trustedOrigin,'content-type':'application/json'},body:JSON.stringify(a),signal:trustedAbortSignal});
   const response=await fetch(request,trustedContext);
   if(trustedAbortSignal?.aborted)return toolResult(id,{error:'request_cancelled'},true);
   const value=await response.json();
   if(trustedAbortSignal?.aborted)return toolResult(id,{error:'request_cancelled'},true);
   if(response.status!==200){const code=exact(value,['error'])&&typeof value.error==='string'&&HTTP_ERRORS[response.status]?.includes(value.error)?value.error:'query_failed';return toolResult(id,{error:code},true);}
   const success=safeSuccess(value,a.query);return success?toolResult(id,success,false):toolResult(id,{error:'query_failed'},true);
  }catch{return validated?toolResult(id,{error:'query_failed'},true):protocol(id,-32600,'Invalid Request');}
 }});
}
