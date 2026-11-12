// Explicitly fake connector envelopes, suitable for tests and local demos only.
import {createHash} from 'node:crypto';
export function makeSyntheticProviderResponse(provider,bytes,{filename='selected.pdf',query='PDF',profile=null}={}){
  if(!['gmail','icloud'].includes(provider)||!(bytes instanceof Uint8Array))throw Error('Synthetic provider input required');
  const source={source_ref:'synthetic-selected-'+provider,provider,account_ref:'synthetic-account',message_id:'opaque-synthetic-message-'+provider,
    attachment_id:provider==='gmail'?null:'1.2',filename,sha256:createHash('sha256').update(bytes).digest('hex')};
  let payload;
  if(provider==='gmail'){
    const eml=['From: sender@example.invalid','To: recipient@example.invalid','Subject: Local synthetic fixture - not sent','MIME-Version: 1.0',
      'Content-Type: multipart/mixed; boundary="synthetic-boundary"','','--synthetic-boundary','Content-Type: text/plain','','Synthetic only',
      '--synthetic-boundary','Content-Type: application/pdf',`Content-Disposition: attachment; filename="${filename}"`,'Content-Transfer-Encoding: base64','',
      ...Buffer.from(bytes).toString('base64').match(/.{1,76}/g),'--synthetic-boundary--',''].join('\r\n');
    payload={id:source.message_id,raw:Buffer.from(eml).toString('base64url')};
  }else payload={id:source.message_id,attachments:[{id:source.attachment_id,filename,size:bytes.length,mime_type:'application/pdf',is_inline:false,
    file:{file_name:filename,mime_type:'application/pdf',file_id:'file_00000000000000000000000000000001',
      download_url:'https://sdmntprsynthetic.oaiusercontent.com/files/00000000-0000-0000-0000-000000000001/raw?synthetic=not-a-token'}}]};
  return {selection:{source,size_bytes:bytes.length,query,password_profile:profile},
    connection:{provider,account_ref:source.account_ref,connection_ref:'synthetic-connection'},
    route:provider==='gmail'?'gmail_raw':'icloud_original',response:{content:[],structuredContent:payload},bytes};
}
