// Host boundary for selected ORIGINAL attachments, exercised with synthetic
// data only. Tool invocation, real response decoding and file redemption must
// be supplied by the trusted host. No default network/tool client is provided.
import {fixedFixtures} from './fixed-fixtures.mjs';

const sourceKeys=['source_ref','provider','account_ref','message_id','attachment_id','filename','sha256'];
const exact=(v,keys)=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const identifier=v=>typeof v==='string'&&v.length>0&&v.length<=512&&!/[\u0000-\u001f\u007f]/u.test(v);
const errorCodes=new Set(['invalid_selection','connection_mismatch','fixture_not_allowed','attachment_read_unsupported','ambiguous_filename','complete_attachment_id_required','invalid_original_payload','invalid_file_reference','invalid_identity_echo','identity_mismatch','invalid_original_stream','request_cancelled','invalid_original_chunk','attachment_size_mismatch','attachment_integrity_failed','tool_read_failed','response_decode_failed','original_read_failed','invalid_materialized_attachment','boundary_failed']);
export class AttachmentBoundaryError extends Error {
  constructor(code){super('Selected attachment unavailable');this.name='AttachmentBoundaryError';this.code=errorCodes.has(code)?code:'boundary_failed';}
}
const fail=code=>{throw new AttachmentBoundaryError(code);};

function snapshotSelection(selection,connection) {
  if(!exact(selection,['source','size_bytes','attachment_id_complete','filename_unique_in_message','read_attachment_supported']) ||
    !exact(selection.source,sourceKeys)) fail('invalid_selection');
  const s=selection.source;
  if(!sourceKeys.filter(k=>k!=='attachment_id').every(k=>identifier(s[k])) ||
    !(s.attachment_id===null || identifier(s.attachment_id)) ||
    !['gmail','icloud'].includes(s.provider) || !/^[0-9a-f]{64}$/.test(s.sha256) ||
    typeof selection.attachment_id_complete!=='boolean' || typeof selection.filename_unique_in_message!=='boolean' ||
    ![true,false,null].includes(selection.read_attachment_supported)) fail('invalid_selection');
  if(connection && (s.provider!==connection.provider || s.account_ref!==connection.account_ref)) fail('connection_mismatch');
  // This candidate is intentionally limited to the existing public fixture set.
  const fixture=fixedFixtures.find(f=>f.fixture_id===s.filename && f.sha256===s.sha256);
  if(!fixture || selection.size_bytes!==fixture.bytes) fail('fixture_not_allowed');
  // A truncated ID is not an ID suitable for a citation or tool call. Keep the
  // exact unique filename fallback, but explicitly represent the unknown ID.
  return Object.freeze({...selection,source:Object.freeze({...s,attachment_id:selection.attachment_id_complete?s.attachment_id:null})});
}

export function planAttachmentRead(selection) {
  const s=snapshotSelection(selection);const source=s.source;
  if(source.provider==='gmail') {
    if(s.read_attachment_supported!==true) fail('attachment_read_unsupported');
    if(source.attachment_id!==null && s.attachment_id_complete) return Object.freeze({
      name:'mcp__codex_apps__gmail_read_attachment',arguments:Object.freeze({message_id:source.message_id,attachment_id:source.attachment_id})
    });
    if(!s.filename_unique_in_message) fail('ambiguous_filename');
    return Object.freeze({name:'mcp__codex_apps__gmail_read_attachment',arguments:Object.freeze({message_id:source.message_id,filename:source.filename})});
  }
  if(source.attachment_id===null || !s.attachment_id_complete) fail('complete_attachment_id_required');
  return Object.freeze({name:'mcp__codex_apps__icloud_mail_get_message',arguments:Object.freeze({message_id:source.message_id,attachment_ids:Object.freeze([source.attachment_id])})});
}

function validateDecoded(decoded,selection) {
  // This is our INTERNAL decoder contract, NOT a provider's returned JSON schema.
  if(!exact(decoded,['kind','reference','identity','original_truncated']) || decoded.original_truncated!==false ||
    decoded.kind!==(selection.source.provider==='gmail'?'gmail_original_file':'icloud_original_file')) fail('invalid_original_payload');
  if(!(typeof decoded.reference==='string' && decoded.reference.length>0 && decoded.reference.length<=16384) &&
    !(decoded.reference!==null && typeof decoded.reference==='object' && !Array.isArray(decoded.reference))) fail('invalid_file_reference');
  const identity=decoded.identity;
  if(identity===null || typeof identity!=='object' || Array.isArray(identity) ||
    Object.keys(identity).some(k=>!['message_id','attachment_id','filename','size_bytes'].includes(k))) fail('invalid_identity_echo');
  // Missing echo fields stay missing. The trusted host must bind a response to
  // its invocation; this module must not invent an echo to claim provider proof.
  for(const [key,value] of Object.entries(identity)) {
    const expected=key==='size_bytes'?selection.size_bytes:selection.source[key];
    if(value!==expected) fail('identity_mismatch');
  }
  return decoded.reference;
}

async function boundedOriginal(stream,expectedBytes,signal) {
  if(!stream || typeof stream[Symbol.asyncIterator]!=='function') fail('invalid_original_stream');
  const data=new Uint8Array(expectedBytes);let offset=0,count=0;
  try {
    for await(const chunk of stream) {
      if(signal?.aborted) fail('request_cancelled');
      if(++count>expectedBytes || !(chunk instanceof Uint8Array) || chunk.byteLength===0) fail('invalid_original_chunk');
      if(offset+chunk.byteLength>expectedBytes) fail('attachment_size_mismatch');
      data.set(chunk,offset);offset+=chunk.byteLength;
    }
    if(signal?.aborted) fail('request_cancelled');
    if(offset!==expectedBytes) fail('attachment_size_mismatch');
    return data;
  } catch(error) {data.fill(0);throw error;}
}

export function createSelectedAttachmentAdapter({connection,invoke,decodeOriginal,readOriginal}={}) {
  if(!exact(connection,['provider','account_ref','connection_ref']) || !['gmail','icloud'].includes(connection.provider) ||
    !identifier(connection.account_ref) || !identifier(connection.connection_ref)) throw new Error('Invalid host connection');
  if(typeof invoke!=='function' || typeof decodeOriginal!=='function' || typeof readOriginal!=='function') throw new Error('Explicit host transport and decoder required');
  const scope=Object.freeze({...connection});
  return Object.freeze({async readSelected(input,{signal}={}) {
    const selection=snapshotSelection(input,scope),plan=planAttachmentRead(selection);
    const context=Object.freeze({connection:scope,selection,plan,signal});
    const check=()=>{if(signal?.aborted) fail('request_cancelled');};
    let stage='tool_read_failed',bytes;
    try {
      check();const raw=await invoke(plan,context);check();
      stage='response_decode_failed';const decoded=await decodeOriginal(raw,context);check();
      const reference=validateDecoded(decoded,selection);
      stage='original_read_failed';const stream=await readOriginal(reference,context);check();
      bytes=await boundedOriginal(stream,selection.size_bytes,signal);
      const sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
      check();if(sha256!==selection.source.sha256) fail('attachment_integrity_failed');
      return {source:{...selection.source},bytes,sha256};
    } catch(error) {
      bytes?.fill(0);
      if(signal?.aborted) fail('request_cancelled');
      // Rebuild even our exported error type: an injected callback can mutate
      // its message/code (or throw a hostile accessor). Never forward it raw.
      let code;
      try {if(error instanceof AttachmentBoundaryError) code=error.code;} catch {/* fixed stage below */}
      if(code!==undefined) throw new AttachmentBoundaryError(code);
      fail(stage);
    }
  }});
}

export function makeSyntheticSearchInput(original,{query,password_profile}) {
  if(!(original?.bytes instanceof Uint8Array) || original.sha256!==original.source?.sha256) fail('invalid_materialized_attachment');
  const fixture=fixedFixtures.find(f=>f.fixture_id===original.source.filename && f.sha256===original.sha256);
  if(!fixture || original.bytes.length!==fixture.bytes) fail('fixture_not_allowed');
  // Bounded by pinned fixture sizes, not an unbounded argument spread.
  let binary='';for(const b of original.bytes) binary+=String.fromCharCode(b);
  return {source_ref:original.source.source_ref,filename:original.source.filename,
    data_base64:btoa(binary),sha256:original.sha256,password_profile,query};
}
