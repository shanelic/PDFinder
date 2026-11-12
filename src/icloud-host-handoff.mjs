// INTERNAL host receipt, not the iCloud tool's JSON schema. A host still needs
// a verified real response decoder/file-redemption implementation. Object identity
// prevents accidental cross-invocation handoff, not a malicious/unauthenticated host.
import {AttachmentBoundaryError} from './provider-attachments.mjs';
const exact=(v,keys)=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const fail=code=>{throw new AttachmentBoundaryError(code);};
export function decodeIcloudHostHandoff(receipt,context) {
  if(context?.connection?.provider!=='icloud'||context?.selection?.source?.provider!=='icloud'||
    context.connection.account_ref!==context.selection.source.account_ref||
    context.selection.attachment_id_complete!==true||typeof context.selection.source.attachment_id!=='string'||!context.selection.source.attachment_id||
    context.plan?.name!=='mcp__codex_apps__icloud_mail_get_message'||
    !exact(context.plan.arguments,['message_id','attachment_ids'])||
    !Array.isArray(context.plan.arguments?.attachment_ids)||context.plan.arguments.attachment_ids.length!==1||
    context.plan.arguments.attachment_ids[0]!==context.selection.source.attachment_id||
    context.plan.arguments.message_id!==context.selection.source.message_id)fail('invalid_selection');
  if(!exact(receipt,['received_for','originals'])||receipt.received_for!==context)fail('identity_mismatch');
  if(!Array.isArray(receipt.originals)||receipt.originals.length!==1||!Object.hasOwn(receipt.originals,0))fail('invalid_original_payload');
  const item=receipt.originals[0];
  if(!exact(item,['kind','reference','identity','complete'])||item.kind!=='original_attachment'||item.complete!==true)fail('invalid_original_payload');
  if(!(typeof item.reference==='string'&&item.reference.length>0&&item.reference.length<=16384)&&
    !(item.reference!==null&&typeof item.reference==='object'&&!Array.isArray(item.reference)))fail('invalid_file_reference');
  if(!item.identity||typeof item.identity!=='object'||Array.isArray(item.identity)||
    Object.keys(item.identity).some(k=>!['message_id','attachment_id','filename','size_bytes'].includes(k)))fail('invalid_identity_echo');
  for(const [key,value] of Object.entries(item.identity)) {
    if(value!==(key==='size_bytes'?context.selection.size_bytes:context.selection.source[key]))fail('identity_mismatch');
  }
  return {kind:'icloud_original_file',reference:item.reference,identity:{...item.identity},original_truncated:false};
}
