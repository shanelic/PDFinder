// Local synthetic HOST boundary, not authentication implementation or HTTP route.
// Only the host may supply callbacks/context. Caller input contains no identity.
// authenticate must verify the server session; never trust a caller verified flag.
// Gmail gmail_raw grants authorize reading the WHOLE exact message, not just PDF.
// Revocation can discard results, not unread fetched bytes or stop in-flight CPU.
import {createSelectedMailSearch,SelectedMailSearchError} from './selected-mail-search.mjs';
import {DocumentSearchError} from './bounded-document-search.mjs';
import {createSyntheticProfileScope} from './synthetic-password-profiles.mjs';
const exact=(v,keys)=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const synthetic=v=>typeof v==='string'&&/^(?:opaque-)?synthetic-[A-Za-z0-9._-]{1,80}$/.test(v);
const codes=new Set(['invalid_request','host_configuration_invalid','authentication_failed','selection_unavailable','profile_unavailable','query_failed']);
export class SyntheticHostQueryError extends Error{constructor(code){super('Synthetic host query failed');this.name='SyntheticHostQueryError';this.code=codes.has(code)?code:'query_failed';}}
const fail=code=>{throw new SyntheticHostQueryError(code);};
export function createSyntheticHostQuery({authenticate,readGrant,invoke,readOriginal,loadParser,resolvePassword}={}){
 if([authenticate,readGrant,invoke,readOriginal,loadParser,resolvePassword].some(f=>typeof f!=='function'))fail('host_configuration_invalid');
 return Object.freeze({async query(request,trustedContext){
  let input;
  try{input=structuredClone(request);if(!exact(input,['selection_ref','query'])||!synthetic(input.selection_ref)||typeof input.query!=='string'||!input.query.trim()||Array.from(input.query).length>80||/[\u0000-\u001f\u007f]/u.test(input.query)||Array.from(input.query).some(c=>c.length===1&&/[\ud800-\udfff]/u.test(c)))fail('invalid_request');}catch{fail('invalid_request');}
  let auth,baseline,blocked;
  const deny=code=>{blocked=code;fail(code);};
  async function check(){
   let identity;try{identity=structuredClone(await authenticate(trustedContext));}catch{deny('authentication_failed');}
   if(!exact(identity,['principal_id','connection_ref'])||!synthetic(identity.principal_id)||!synthetic(identity.connection_ref))deny('authentication_failed');
   if(auth&&(identity.principal_id!==auth.principal_id||identity.connection_ref!==auth.connection_ref))deny('authentication_failed');auth=Object.freeze(identity);
   let grant;try{grant=structuredClone(await readGrant(auth.principal_id,input.selection_ref));}catch{deny('selection_unavailable');}
   try{
    if(!exact(grant,['principal_id','selection_ref','revision','active','connection','route','selection'])||grant.active!==true||grant.principal_id!==auth.principal_id||grant.selection_ref!==input.selection_ref||!Number.isSafeInteger(grant.revision)||grant.revision<1||
      grant.connection.connection_ref!==auth.connection_ref||!synthetic(grant.selection.password_profile)||!exact(grant.selection,['source','size_bytes','password_profile']))deny('selection_unavailable');
    const s=grant.selection.source;
    if(!synthetic(s.account_ref)||!synthetic(s.message_id)||!synthetic(s.source_ref)||s.filename!=='AES-256.pdf'||grant.selection.size_bytes!==1825)deny('selection_unavailable');
    createSyntheticProfileScope(grant.connection,s);
    if(grant.route!==(s.provider==='gmail'?'gmail_raw':'icloud_original'))deny('selection_unavailable');
   }catch{deny('selection_unavailable');}
   const c=grant.connection,s=grant.selection.source;
   const fingerprint=JSON.stringify([grant.principal_id,grant.selection_ref,grant.revision,grant.active,
    c.provider,c.account_ref,c.connection_ref,grant.route,grant.selection.size_bytes,grant.selection.password_profile,
    s.source_ref,s.provider,s.account_ref,s.message_id,s.attachment_id,s.filename,s.sha256]);if(baseline&&baseline!==fingerprint)deny('selection_unavailable');baseline=fingerprint;
   Object.freeze(grant.connection);Object.freeze(grant.selection.source);Object.freeze(grant.selection);return Object.freeze(grant);
  }
  async function password(grant){
   let value;try{value=await resolvePassword(grant.connection,grant.selection.password_profile,grant.selection.source);}catch{deny('profile_unavailable');}
   if(value!=='SYNTHETIC-ONLY-DO-NOT-USE'&&value!=='PUBLIC-WRONG-SYNTHETIC-PASSWORD')deny('profile_unavailable');return value;
  }
  try{
   const grant=await check();await password(grant);await check(); // fail before mail read if profile already revoked
   const bridge=createSelectedMailSearch({connection:grant.connection,route:grant.route,loadParser,
    invoke:async(plan,context)=>{await check();return invoke(plan,context);},
    readOriginal:async(reference,context)=>{
     await check();const stream=await readOriginal(reference,context);
     return (async function*(){for await(const chunk of stream){await check();yield chunk;}})();
    },
    resolvePassword:async()=>{const current=await check();const value=await password(current);await check();return value;}
   });
   const result=await bridge.search({...grant.selection,query:input.query});await check();await password(grant);await check();return result;
  }catch(e){
   if(blocked)fail(blocked);
   if(e instanceof DocumentSearchError)throw new DocumentSearchError(e.code);
   if(e instanceof SelectedMailSearchError)throw new SelectedMailSearchError(e.code);
   fail('query_failed');
  }
 }});
}
