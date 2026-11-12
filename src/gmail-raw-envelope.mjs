// Observed read_email(format="raw") envelope boundary only. Not a MIME parser
// or an automatic fallback from read_attachment. The host must explicitly select
// this whole-message read and later identify the exact attachment within MIME.
import {AttachmentBoundaryError} from './provider-attachments.mjs';
const fail=code=>{throw new AttachmentBoundaryError(code);};
export function decodeGmailRawEnvelope(payload,expectedMessageId,{maxBytes=1048576}={}) {
  if(typeof expectedMessageId!=='string' || !expectedMessageId ||
    !Number.isSafeInteger(maxBytes) || maxBytes<1 || maxBytes>1048576) fail('invalid_selection');
  if(!payload || typeof payload!=='object' || Array.isArray(payload) || payload.id!==expectedMessageId) fail('identity_mismatch');
  const raw=payload.raw;
  if(typeof raw!=='string' || !raw.length || raw.length>4*Math.ceil(maxBytes/3) ||
    !/^[A-Za-z0-9_-]+={0,2}$/.test(raw) || raw.length%4===1) fail('invalid_original_payload');
  const unpadded=raw.replace(/=+$/,'');
  let binary;
  try {binary=atob(unpadded.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-unpadded.length%4)%4));}
  catch {fail('invalid_original_payload');}
  const canonical=btoa(binary).replace(/\+/g,'-').replace(/\//g,'_');
  if(raw!==canonical && raw!==canonical.replace(/=+$/,'')) fail('invalid_original_payload');
  if(binary.length>maxBytes) fail('attachment_size_mismatch');
  return Uint8Array.from(binary,c=>c.charCodeAt(0));
}
