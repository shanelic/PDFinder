// Request/Response adapter ONLY. No listener, deployment or authentication.
// trustedContext is server-injected; body/headers/URL never supply identity.
import {SyntheticHostQueryError} from './synthetic-host-query.mjs';
import {DocumentSearchError} from './bounded-document-search.mjs';
import {SelectedMailSearchError} from './selected-mail-search.mjs';
const reply=(status,value)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','vary':'Origin'}});
const error=(status,code)=>reply(status,{error:code});
const STRING='"(?:[^"\\\\\\u0000-\\u001f]|\\\\(?:["\\\\/bfnrt]|u[0-9a-fA-F]{4}))*"';
const PAIR='"(?:selection_ref|query)"\\s*:\\s*'+STRING;
const BODY=new RegExp('^\\s*\\{\\s*'+PAIR+'\\s*,\\s*'+PAIR+'\\s*\\}\\s*$','u');
function abortable(promise,signal){
 if(signal.aborted){void Promise.resolve(promise).catch(()=>{});return Promise.resolve({cancelled:true});}
 return new Promise((resolve,reject)=>{
  const abort=()=>{signal.removeEventListener('abort',abort);resolve({cancelled:true});};
  signal.addEventListener('abort',abort,{once:true});
  Promise.resolve(promise).then(value=>{signal.removeEventListener('abort',abort);resolve({value});},e=>{signal.removeEventListener('abort',abort);reject(e);});
  if(signal.aborted)abort();
 });
}
export function createSyntheticHostHttp({host,trustedOrigin}={}){
 let query;
 try{const url=new URL(trustedOrigin);if(url.protocol!=='https:'||url.origin!==trustedOrigin||typeof host?.query!=='function')throw Error();query=host.query.bind(host);}catch{throw Error('Synthetic HTTP host configuration invalid');}
 return Object.freeze({async fetch(request,trustedContext){
  let reader;
  try{
   if(!(request instanceof Request))return error(400,'invalid_request');
   const url=new URL(request.url);
   if(url.origin!==trustedOrigin||request.headers.get('origin')!==trustedOrigin||request.headers.get('sec-fetch-site')==='cross-site')return error(403,'origin_rejected');
   if(url.pathname!=='/v1/selected-mail/search'||url.search||url.hash)return error(404,'route_not_found');
   if(request.method!=='POST')return error(405,'method_not_allowed');
   if(request.signal.aborted)return error(499,'request_cancelled');
   if(!/^application\/json(?:;\s*charset=utf-8)?$/i.test(request.headers.get('content-type')??'')||request.headers.has('content-encoding'))return error(415,'unsupported_media_type');
   const declared=request.headers.get('content-length');
   if(declared!==null&&(!/^(0|[1-9][0-9]*)$/.test(declared)||Number(declared)>2048))return error(413,'body_too_large');
   if(!request.body)return error(400,'invalid_request');
   reader=request.body.getReader();const parts=[];let bytes=0,chunks=0;
   while(true){const read=await abortable(reader.read(),request.signal);if(read.cancelled){void reader.cancel().catch(()=>{});return error(499,'request_cancelled');}
    const {done,value}=read.value;if(done)break;
    if(!(value instanceof Uint8Array)||++chunks>128||(bytes+=value.byteLength)>2048){void reader.cancel().catch(()=>{});return error(413,'body_too_large');}parts.push(value.slice());
   }
   if(declared!==null&&Number(declared)!==bytes)return error(400,'invalid_request');
   const data=new Uint8Array(bytes);let offset=0;for(const part of parts){data.set(part,offset);offset+=part.byteLength;}
   let input;try{const text=new TextDecoder('utf-8',{fatal:true}).decode(data);if(!BODY.test(text))return error(400,'invalid_request');input=JSON.parse(text);if(Object.keys(input).length!==2||!Object.hasOwn(input,'selection_ref')||!Object.hasOwn(input,'query'))return error(400,'invalid_request');}catch{return error(400,'invalid_request');}
   if(request.signal.aborted)return error(499,'request_cancelled');
   // Abort discards the result, not ongoing host reads or parsing work.
   const result=await abortable(query(input,trustedContext),request.signal);
   if(result.cancelled||request.signal.aborted)return error(499,'request_cancelled');return reply(200,result.value);
  }catch(e){
   if(request instanceof Request&&request.signal.aborted)return error(499,'request_cancelled');
   try{if(e instanceof SyntheticHostQueryError){const map={invalid_request:400,authentication_failed:401,selection_unavailable:404,profile_unavailable:422};return error(map[e.code]??500,Object.hasOwn(map,e.code)?e.code:'query_failed');}
   if(e instanceof DocumentSearchError)return error(['cleanup_failed','parser_failed','invalid_parser_result','invalid_limits'].includes(e.code)?500:422,'document_processing_failed');
   if(e instanceof SelectedMailSearchError)return error(502,'mail_processing_failed');}catch{}
   return error(500,'query_failed');
  }finally{try{reader?.releaseLock();}catch{}}
 }});
}
