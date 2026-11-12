// Narrow observed get_message(..., attachment_ids:[id]) original-file envelope.
// Pure decoder: no download, credential handling, logging or mailbox calls.
// Supported file URL shape is intentionally pinned to the observed host contract;
// an unfamiliar provider/shape must be verified, not silently followed.
import {AttachmentBoundaryError} from './provider-attachments.mjs';
const fail=code=>{throw new AttachmentBoundaryError(code);};
const id=value=>typeof value==='string'&&value.length>0&&value.length<=16384&&!/[\u0000-\u001f\u007f]/u.test(value);

export function decodeIcloudAttachmentEnvelope(payload,selection) {
  if(!selection||!id(selection.message_id)||!id(selection.attachment_id)||!id(selection.filename)||
    !Number.isSafeInteger(selection.size_bytes)||selection.size_bytes<1||selection.size_bytes>2097152)fail('invalid_selection');
  if(!payload||typeof payload!=='object'||Array.isArray(payload)||payload.id!==selection.message_id||Object.hasOwn(payload,'error'))fail('identity_mismatch');
  if(!Array.isArray(payload.attachments)||payload.attachments.length>100)fail('invalid_original_payload');
  const ids=new Set();let selected;
  for(let i=0;i<payload.attachments.length;i++) {
    const item=payload.attachments[i];
    if(!item||typeof item!=='object'||Array.isArray(item)||!id(item.id)||ids.has(item.id))fail('invalid_original_payload');
    ids.add(item.id);
    if(item.id===selection.attachment_id)selected=item;
    else if(item.file!==null&&item.file!==undefined)fail('invalid_original_payload');
  }
  if(!selected||selected.filename!==selection.filename||selected.size!==selection.size_bytes)fail('identity_mismatch');
  if(selected.mime_type!=='application/pdf'||selected.is_inline!==false)fail('invalid_original_payload');
  const file=selected.file;
  if(!file||typeof file!=='object'||Array.isArray(file)||file.file_name!==selected.filename||file.mime_type!=='application/pdf'||
    typeof file.file_id!=='string'||!/^file_[0-9a-f]{32}$/.test(file.file_id)||typeof file.download_url!=='string'||file.download_url.length>16384)fail('invalid_file_reference');
  let url;try{url=new URL(file.download_url);}catch{fail('invalid_file_reference');}
  if(url.protocol!=='https:'||url.username||url.password||url.port||url.hash||
    !/^sdmntpr[a-z0-9-]*\.oaiusercontent\.com$/.test(url.hostname))fail('invalid_file_reference');
  const match=/^\/files\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/raw$/.exec(url.pathname);
  if(!match||'file_'+match[1].replace(/-/g,'')!==file.file_id)fail('invalid_file_reference');
  // body_truncated describes HTML, not attachment bytes. The provider contract
  // returns an original file reference; actual completeness is still established
  // by the host reader's exact byte count and SHA check, never by an HTML flag.
  return {kind:'icloud_original_file',reference:Object.freeze({
    download_url:file.download_url,file_id:file.file_id,mime_type:file.mime_type,file_name:file.file_name
  }),identity:{message_id:payload.id,attachment_id:selected.id,filename:selected.filename,size_bytes:selected.size},original_truncated:false};
}
