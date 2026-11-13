// Synthetic-only host candidate: not a vault, identity service or persistent store.
// Storage is explicitly injected and trusted. Only the two PUBLIC test values
// below are accepted; no password input, filesystem, network or credential API.
import {PUBLIC_SYNTHETIC_PASSWORD} from './synthetic-mail-fixture.mjs';
const VALUES=Object.freeze({'fixture-aes256':PUBLIC_SYNTHETIC_PASSWORD,'wrong-test-value':'PUBLIC-WRONG-SYNTHETIC-PASSWORD'});
const PIN='88bcd7d2be5ff65e024d6b3a5964da2a0d10b1f36cbb2616abfc60556a8fe47c';
const exact=(v,keys)=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const synthetic=v=>typeof v==='string'&&/^(?:opaque-)?synthetic-[A-Za-z0-9._-]{1,96}$/.test(v);
const opaque=v=>typeof v==='string'&&v.length>0&&v.length<=512&&!/[\u0000-\u001f\u007f]/u.test(v);
const scopeKeys=['provider','account_ref','connection_ref','message_id','attachment_id','filename','sha256'];
const validValue=value=>typeof value==='string'&&Object.hasOwn(VALUES,value);
const codes=new Set(['invalid_profile_input','profile_missing','profile_revoked','scope_denied','revision_conflict','storage_unavailable','storage_invalid']);
export class SyntheticProfileError extends Error {
  constructor(code){super('Synthetic profile operation failed');this.name='SyntheticProfileError';this.code=codes.has(code)?code:'storage_unavailable';}
}
const fail=code=>{throw new SyntheticProfileError(code);};
const validScope=s=>exact(s,scopeKeys)&&['gmail','icloud'].includes(s.provider)&&opaque(s.account_ref)&&opaque(s.connection_ref)&&opaque(s.message_id)&&
  (s.provider==='gmail'?s.attachment_id===null:typeof s.attachment_id==='string'&&/^\d+(?:\.\d+)*$/.test(s.attachment_id)&&s.attachment_id.length<=32)&&
  s.filename==='AES-256.pdf'&&s.sha256===PIN;
const scopeKey=s=>JSON.stringify(scopeKeys.map(k=>s[k]));
const validScopes=s=>Array.isArray(s)&&s.length>0&&s.length<=8&&
  Array.from({length:s.length},(_,i)=>Object.hasOwn(s,i)&&validScope(s[i])).every(Boolean)&&new Set(s.map(scopeKey)).size===s.length;
const validRecord=(r,id)=>exact(r,['profile_id','revision','state','value_id','scopes'])&&r.profile_id===id&&synthetic(id)&&Number.isSafeInteger(r.revision)&&r.revision>0&&
  validScopes(r.scopes)&&(r.state==='active'&&validValue(r.value_id)||r.state==='revoked'&&r.value_id===null);
const metadata=r=>Object.freeze({profile_id:r.profile_id,revision:r.revision,state:r.state,scope_count:r.scopes.length});
function guarded(fn){return async(...args)=>{try{return await fn(...args);}catch(e){let code;try{if(e instanceof SyntheticProfileError)code=e.code;}catch{}throw new SyntheticProfileError(code);}};}

// Correlation source_ref is validated but deliberately not part of authority.
export function createSyntheticProfileScope(connection,source) {
  try {
    if(!exact(connection,['provider','account_ref','connection_ref'])||!exact(source,['source_ref','provider','account_ref','message_id','attachment_id','filename','sha256'])||
      !opaque(source.source_ref)||connection.provider!==source.provider||connection.account_ref!==source.account_ref)fail('invalid_profile_input');
    const scope={provider:source.provider,account_ref:source.account_ref,connection_ref:connection.connection_ref,message_id:source.message_id,
      attachment_id:source.attachment_id,filename:source.filename,sha256:source.sha256};
    if(!validScope(scope))fail('invalid_profile_input');return Object.freeze(scope);
  }catch{fail('invalid_profile_input');}
}

// Atomic only within this in-memory store instance. Restart loses ALL state.
// A production adapter would need its own atomicity, access and persistence
// guarantees. This factory neither grants nor verifies those guarantees.
export function createInMemorySyntheticProfileStorage() {
  const records=new Map();
  return Object.freeze({
    read:guarded(async id=>{if(!synthetic(id))fail('invalid_profile_input');return records.has(id)?structuredClone(records.get(id)):null;}),
    compareAndSwap:guarded(async(id,expectedRevision,next)=>{
      if(!synthetic(id)||!(expectedRevision===null||Number.isSafeInteger(expectedRevision)&&expectedRevision>0)||!validRecord(next,id)||
        next.revision!==(expectedRevision===null?1:expectedRevision+1))fail('invalid_profile_input');
      const previous=records.get(id);
      if((previous?.revision??null)!==expectedRevision||previous?.state==='revoked')return false;
      records.set(id,structuredClone(next));return true;
    })
  });
}

export function createSyntheticPasswordProfiles({storage}={}) {
  // Bind methods once; storage remains a trusted dependency, not a vault API.
  let read,cas;
  try {
    const readMethod=storage?.read,casMethod=storage?.compareAndSwap;
    if(typeof readMethod!=='function'||typeof casMethod!=='function')fail('invalid_profile_input');
    read=readMethod.bind(storage);cas=casMethod.bind(storage);
  }catch{fail('invalid_profile_input');}
  const current=async id=>{
    if(!synthetic(id))fail('invalid_profile_input');
    let record;try{record=await read(id);}catch{fail('storage_unavailable');}
    if(record===null)fail('profile_missing');
    try{const snapshot=structuredClone(record);if(!validRecord(snapshot,id))fail('storage_invalid');return snapshot;}catch{fail('storage_invalid');}
  };
  const write=async(id,revision,next)=>{
    let result;try{result=await cas(id,revision,structuredClone(next));}catch{fail('storage_unavailable');}
    if(result===false)fail('revision_conflict');if(result!==true)fail('storage_invalid');
    return metadata(next);
  };
  const mutation=async input=>{
    const r=await current(input.profile_id);if(r.state==='revoked')fail('profile_revoked');
    if(r.revision!==input.expected_revision)fail('revision_conflict');
    if(r.revision===Number.MAX_SAFE_INTEGER)fail('revision_conflict');return r;
  };
  const service={
    create:guarded(async input=>{
      if(!exact(input,['profile_id','value_id','scopes'])||!synthetic(input.profile_id)||!validValue(input.value_id)||!validScopes(input.scopes))fail('invalid_profile_input');
      return write(input.profile_id,null,{profile_id:input.profile_id,revision:1,state:'active',value_id:input.value_id,scopes:structuredClone(input.scopes)});
    }),
    replace:guarded(async input=>{
      if(!exact(input,['profile_id','expected_revision','value_id'])||!validValue(input.value_id)||!Number.isSafeInteger(input.expected_revision)||input.expected_revision<1)fail('invalid_profile_input');
      // Snapshot before awaiting storage so caller mutation cannot widen/change it.
      input={...input};const r=await mutation(input);
      return write(r.profile_id,r.revision,{...r,revision:r.revision+1,value_id:input.value_id});
    }),
    revoke:guarded(async input=>{
      if(!exact(input,['profile_id','expected_revision'])||!Number.isSafeInteger(input.expected_revision)||input.expected_revision<1)fail('invalid_profile_input');
      input={...input};const r=await mutation(input);
      return write(r.profile_id,r.revision,{...r,revision:r.revision+1,state:'revoked',value_id:null});
    }),
    describe:guarded(async id=>metadata(await current(id))),
    resolverFor(connection) {
      try {
        if(!exact(connection,['provider','account_ref','connection_ref'])||!['gmail','icloud'].includes(connection.provider)||!opaque(connection.account_ref)||!opaque(connection.connection_ref))fail('invalid_profile_input');
        connection=Object.freeze({...connection});
      }catch{fail('invalid_profile_input');}
      return guarded(async(profile,source)=>{
        let scope;try{scope=createSyntheticProfileScope(connection,source);}catch{fail('scope_denied');}
        const r=await current(profile);if(r.state==='revoked')fail('profile_revoked');
        if(!r.scopes.some(s=>scopeKey(s)===scopeKey(scope)))fail('scope_denied');
        // Re-read for each resolution; no value cache. Once returned, a string
        // cannot be revoked from an already-started parser or erased globally.
        return VALUES[r.value_id];
      });
    }
  };
  return Object.freeze(service);
}
