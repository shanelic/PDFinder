// Host-side acceptance of ONE known public AES-256 fixture, not a mailbox client.
// Responses and the authorized connection must come from the trusted host.
// Unlike the normalized demo API, opaque provider IDs stay unchanged in memory.
import {fixedFixtures} from './fixed-fixtures.mjs';
import {selectGmailRawAttachment} from './gmail-mime-attachment.mjs';
import {decodeIcloudAttachmentEnvelope} from './icloud-attachment-envelope.mjs';
import {createSelectedAttachmentAdapter} from './provider-attachments.mjs';
import {findLiteralMatches} from './page-citations.mjs';
import {PUBLIC_SYNTHETIC_PASSWORD} from './synthetic-mail-fixture.mjs';

const PIN='88bcd7d2be5ff65e024d6b3a5964da2a0d10b1f36cbb2616abfc60556a8fe47c';
const fields=['source_ref','provider','account_ref','message_id','attachment_id','filename','sha256'];
const exact=(v,keys)=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const id=v=>typeof v==='string'&&v.length>0&&v.length<=512&&!/[\u0000-\u001f\u007f]/u.test(v);
const allowed=new Set(['invalid_selection','connection_mismatch','request_cancelled','gmail_original_failed','icloud_original_failed','fixture_integrity_failed','parser_failed','fixture_text_mismatch','buffer_cleanup_failed']);
const wipe=Function.prototype.call.bind(Uint8Array.prototype.fill);
export class SyntheticMailVerificationError extends Error {
  constructor(code){super('Known synthetic mail verification failed');this.name='SyntheticMailVerificationError';this.code=allowed.has(code)?code:'parser_failed';}
}
const fail=code=>{throw new SyntheticMailVerificationError(code);};
const digest=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');

export function createSyntheticMailVerifier({connection,loadParser,readOriginal}={}) {
  if(!exact(connection,['provider','account_ref','connection_ref'])||!['gmail','icloud'].includes(connection.provider)||
    !id(connection.account_ref)||!id(connection.connection_ref)||typeof loadParser!=='function'||
    (connection.provider==='icloud'&&typeof readOriginal!=='function'))throw new Error('Explicit synthetic host connection and parser required');
  const scope=Object.freeze({...connection});
  const fixture=fixedFixtures.find(f=>f.fixture_id==='AES-256.pdf'&&f.sha256===PIN&&f.bytes===1825&&f.encrypted===true);
  if(!fixture)throw new Error('Known synthetic fixture unavailable');
  return Object.freeze({async verify({source,payload}={}, {signal}={}) {
    if(!exact(source,fields)||!fields.filter(k=>k!=='attachment_id').every(k=>id(source[k]))||
      source.filename!==fixture.fixture_id||source.sha256!==PIN||
      (scope.provider==='gmail'?source.attachment_id!==null:!id(source.attachment_id)))fail('invalid_selection');
    if(source.provider!==scope.provider||source.account_ref!==scope.account_ref)fail('connection_mismatch');
    source=Object.freeze({...source});
    const check=()=>{if(signal?.aborted)fail('request_cancelled');};
    let bytes,stage=scope.provider==='gmail'?'gmail_original_failed':'icloud_original_failed';
    try {
      check();
      if(scope.provider==='gmail') {
        const original=await selectGmailRawAttachment(payload,{message_id:source.message_id,filename:fixture.fixture_id,size_bytes:fixture.bytes,sha256:PIN});
        bytes=original.bytes;
      } else {
        const adapter=createSelectedAttachmentAdapter({connection:scope,invoke:async()=>payload,
          decodeOriginal:(raw,c)=>decodeIcloudAttachmentEnvelope(raw,{message_id:c.selection.source.message_id,
            attachment_id:c.selection.source.attachment_id,filename:fixture.fixture_id,size_bytes:fixture.bytes}),readOriginal});
        const original=await adapter.readSelected({source,size_bytes:fixture.bytes,attachment_id_complete:true,
          filename_unique_in_message:false,read_attachment_supported:null},{signal});
        bytes=original.bytes;
      }
      check();
      if(bytes.length!==fixture.bytes||await digest(bytes)!==PIN)fail('fixture_integrity_failed');
      check();stage='parser_failed';
      const extract=await loadParser();check();
      const result=await extract(bytes,PUBLIC_SYNTHETIC_PASSWORD,{pages:2,characters:2000},{signal});check();
      if(!Array.isArray(result?.pages)||result.pages.length!==fixture.expectedPages.length||
        result.pages.some((p,i)=>!exact(p,['page','text'])||p.page!==fixture.expectedPages[i].page||p.text!==fixture.expectedPages[i].text)||
        result.text_status!=='text_found'||result.coverage?.assessment!=='not_a_completeness_proof')fail('fixture_text_mismatch');
      const found=findLiteralMatches(result.pages,'PDF',source,PIN);
      // The fixed fixture's oracle is not a general document-completeness proof.
      return {schema:'known_synthetic_mail_acceptance_v1',expected_parser_version:'6.2.108',source:{...source},
        sha256:PIN,page_count:result.pages.length,matches:found.matches,
        summary:{provider:scope.provider,fixture:fixture.fixture_id,bytes:fixture.bytes,sha256:PIN,
          page_count:result.pages.length,match_count:found.matches.length,query:'PDF',
          identity_scope:'trusted_host_selected_response_not_authentication',
          coverage:'known_fixture_oracle_not_general_completeness'}};
    } catch(error) {
      if(signal?.aborted)fail('request_cancelled');
      // Never propagate a callback's message or arbitrary provider error code.
      let code;try{if(error instanceof SyntheticMailVerificationError)code=error.code;}catch{}
      throw new SyntheticMailVerificationError(allowed.has(code)?code:stage);
    } finally {
      // A parser can detach a buffer or alter an instance method. A failed
      // cleanup must neither replace redacted errors with raw details nor allow
      // a successful acceptance result to escape with unconfirmed cleanup.
      if(bytes)try{wipe(bytes,0);}catch{throw new SyntheticMailVerificationError('buffer_cleanup_failed');}
    }
  }});
}
