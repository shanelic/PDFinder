// Opt-in, one logical query only. Not a vault, transaction, lease or hard stop.
// Trusted profile service must provide fresh, monotonic metadata. A rollback or
// a change after the last check cannot be detected. Returned strings cannot be
// recalled/erased; this module neither logs values nor controls dependency logs.
import {SyntheticProfileError,createSyntheticProfileScope} from './synthetic-password-profiles.mjs';
import {PUBLIC_SYNTHETIC_PASSWORD} from './synthetic-mail-fixture.mjs';
const exact=(v,keys)=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const validId=v=>typeof v==='string'&&/^(?:opaque-)?synthetic-[A-Za-z0-9._-]{1,96}$/.test(v);
export function createSyntheticProfileRevisionGuard({profiles}={}) {
 let describe,resolverFor;
 try {
  const d=profiles?.describe,r=profiles?.resolverFor;
  if(typeof d!=='function'||typeof r!=='function')throw Error();
  describe=d.bind(profiles);resolverFor=r.bind(profiles);
 }catch{throw new SyntheticProfileError('invalid_profile_input');}
 let binding,revision,scopeCount,busy=false,blocked;
 const deny=code=>{blocked??=code;throw new SyntheticProfileError(blocked);};
 const checkBlocked=()=>{if(blocked)throw new SyntheticProfileError(blocked);};
 const metadata=async profile=>{
  const m=structuredClone(await describe(profile));checkBlocked();
  if(!exact(m,['profile_id','revision','state','scope_count'])||m.profile_id!==profile||
   !Number.isSafeInteger(m.revision)||m.revision<1||!Number.isInteger(m.scope_count)||m.scope_count<1||m.scope_count>8||
   !['active','revoked'].includes(m.state))deny('storage_invalid');
  if(m.state==='revoked')deny('profile_revoked');
  if(revision!==undefined&&(m.revision!==revision||m.scope_count!==scopeCount))deny('revision_conflict');
  revision=m.revision;scopeCount=m.scope_count;
 };
 return async(connection,profile,source)=>{
  checkBlocked();if(busy)deny('revision_conflict');busy=true;
  try {
   let c,s,scope;
   try {c=structuredClone(connection);s=structuredClone(source);scope=createSyntheticProfileScope(c,s);}
   catch{deny('scope_denied');}
   if(!validId(profile))deny('invalid_profile_input');
   // createSyntheticProfileScope emits a fixed field order; source_ref is only
   // correlation and intentionally excluded from the authority fingerprint.
   const key=JSON.stringify([profile,...Object.values(scope)]);
   if(binding!==undefined&&key!==binding)deny('scope_denied');binding=key;
   Object.freeze(c);Object.freeze(s);
   await metadata(profile);checkBlocked();
   const resolve=resolverFor(c);if(typeof resolve!=='function')deny('storage_invalid');
   const value=await resolve(profile,s);checkBlocked();
   if(value!==PUBLIC_SYNTHETIC_PASSWORD&&value!=='PUBLIC-WRONG-SYNTHETIC-PASSWORD')deny('storage_invalid');
   await metadata(profile);checkBlocked();return value;
  }catch(e){
   if(blocked)throw new SyntheticProfileError(blocked);
   let code;try{if(e instanceof SyntheticProfileError)code=e.code;}catch{}
   blocked=new SyntheticProfileError(code).code;throw new SyntheticProfileError(blocked);
  }finally{busy=false;}
 };
}
