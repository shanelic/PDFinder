// Unpublished host bridge. Only explicitly selected read routes; no default
// connector client, network request, fallback, mailbox search, retry or caching.
import {createBoundedDocumentSearch,DocumentSearchError} from './bounded-document-search.mjs';
import {selectGmailRawAttachment} from './gmail-mime-attachment.mjs';
import {decodeIcloudAttachmentEnvelope} from './icloud-attachment-envelope.mjs';
const exact=(v,keys)=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const id=v=>typeof v==='string'&&v.length>0&&v.length<=512&&!/[\u0000-\u001f\u007f]/u.test(v);
const codes=new Set(['connection_mismatch','route_selection_invalid','mail_read_failed','mail_response_rejected','attachment_read_failed','request_cancelled','cleanup_failed','busy']);
const wipe=Function.prototype.call.bind(Uint8Array.prototype.fill);
export class SelectedMailSearchError extends Error {
  constructor(code){super('Selected mail search failed');this.name='SelectedMailSearchError';this.code=codes.has(code)?code:'mail_response_rejected';}
}
const fail=code=>{throw new SelectedMailSearchError(code);};

export function createSelectedMailSearch({connection,route,invoke,readOriginal,loadParser,resolvePassword,limits}={}) {
  if(!exact(connection,['provider','account_ref','connection_ref'])||!['gmail','icloud'].includes(connection.provider)||
    !id(connection.account_ref)||!id(connection.connection_ref)||typeof invoke!=='function'||
    route!==(connection.provider==='gmail'?'gmail_raw':'icloud_original')||
    (connection.provider==='icloud'&&typeof readOriginal!=='function'))throw new Error('Explicit selected-mail host configuration required');
  const scope=Object.freeze({...connection}),processor=createBoundedDocumentSearch({loadParser,resolvePassword,limits});
  let busy=false;
  return Object.freeze({limits:processor.limits,async search(input,{signal}={}) {
    if(busy)fail('busy');
    // Reject malformed/over-budget selections before invoking any mail tool.
    const selection=processor.prepareSelection(input),source=selection.source;
    if(source.provider!==scope.provider||source.account_ref!==scope.account_ref)fail('connection_mismatch');
    // Gmail raw exposes MIME paths, not Gmail opaque attachment IDs. Never
    // silently rewrite a supplied ID or present a MIME path as that ID.
    if(route==='gmail_raw'&&source.attachment_id!==null)fail('route_selection_invalid');
    // Necessary upper bound only: MIME/base64 and headers further reduce the
    // usable attachment size within the existing 1MiB raw-message decoder cap.
    if(route==='gmail_raw'&&selection.size_bytes>786432)fail('route_selection_invalid');
    const plan=route==='gmail_raw'?Object.freeze({name:'mcp__codex_apps__gmail_read_email',arguments:Object.freeze({message_id:source.message_id,format:'raw'})}):
      Object.freeze({name:'mcp__codex_apps__icloud_mail_get_message',arguments:Object.freeze({message_id:source.message_id,attachment_ids:Object.freeze([source.attachment_id])})});
    const context=Object.freeze({connection:scope,selection,plan,signal});
    const check=()=>{if(signal?.aborted)fail('request_cancelled');};
    let ownedBytes,stage='mail_read_failed';busy=true;
    try{
      check();const response=await invoke(plan,context);check();
      if(response?.isError===true)fail('mail_read_failed');
      stage='mail_response_rejected';
      if(!response||typeof response!=='object'||!response.structuredContent||typeof response.structuredContent!=='object'||Array.isArray(response.structuredContent))fail(stage);
      const payload=response.structuredContent;if(Object.hasOwn(payload,'error'))fail(stage);let stream;
      if(route==='gmail_raw'){
        const original=await selectGmailRawAttachment(payload,{message_id:source.message_id,filename:source.filename,size_bytes:selection.size_bytes,sha256:source.sha256});
        ownedBytes=original.bytes;check();stream=(async function*(){yield ownedBytes;})();
      }else{
        const decoded=decodeIcloudAttachmentEnvelope(payload,{message_id:source.message_id,attachment_id:source.attachment_id,filename:source.filename,size_bytes:selection.size_bytes});
        check();stage='attachment_read_failed';stream=await readOriginal(decoded.reference,context);check();
      }
      stage='document_processing';
      const result=await processor.search({...selection,stream},{signal});check();
      return {...result,transport:{route,identity_scope:'trusted_host_connection_not_provider_authentication_proof'}};
    }catch(error){
      if(signal?.aborted)fail('request_cancelled');
      let code,isOwn=false,isDocument=false;try{isOwn=error instanceof SelectedMailSearchError;isDocument=error instanceof DocumentSearchError;code=error?.code;}catch{}
      if(stage==='document_processing'&&isDocument)throw new DocumentSearchError(code);
      if(isOwn)throw new SelectedMailSearchError(code);
      throw new SelectedMailSearchError(stage);
    }finally{
      try{if(ownedBytes)wipe(ownedBytes,0);}catch{throw new SelectedMailSearchError('cleanup_failed');}
      finally{busy=false;}
    }
  }});
}
