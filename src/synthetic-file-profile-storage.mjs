// LOCAL SYNTHETIC TEST ONLY. Public value IDs and fake metadata, not a vault.
// Exclusive lock serializes cooperating instances/processes; contention fails.
// Never recover stale locks automatically. Trusted local directory required:
// no defense against its owner replacing files, rollback or power loss.
import * as fs from 'node:fs/promises';
import {constants} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,dirname,basename} from 'node:path';
import {createInMemorySyntheticProfileStorage,SyntheticProfileError} from './synthetic-password-profiles.mjs';
const LIMIT=32768,MAX_RECORDS=16;
const fail=code=>{throw new SyntheticProfileError(code);};
const synthetic=v=>typeof v==='string'&&/^(?:opaque-)?synthetic-[A-Za-z0-9._-]{1,96}$/.test(v);
async function validate(record){
 const r=structuredClone(record);
 if(!r||!synthetic(r.profile_id)||!Array.isArray(r.scopes))fail('storage_invalid');
 for(const s of r.scopes){
  if(!s||!(synthetic(s.account_ref)||/^[A-Za-z0-9._+-]+@example\.invalid$/.test(s.account_ref))||
    !synthetic(s.connection_ref)||!synthetic(s.message_id))fail('storage_invalid');
 }
 try{await createInMemorySyntheticProfileStorage().compareAndSwap(r.profile_id,r.revision===1?null:r.revision-1,r);}catch{fail('storage_invalid');}
 return r;
}
export async function createSyntheticFileProfileStorage({directory,initialize=false}={}){
 let dir;
 try{dir=resolve(directory);if(dirname(dir)!==resolve(tmpdir())||!/^pdfinder-synthetic-profiles-[A-Za-z0-9]+$/.test(basename(dir)))fail('invalid_profile_input');}catch{fail('invalid_profile_input');}
 const file=join(dir,'profiles.json'),lock=join(dir,'profiles.lock'),pending=join(dir,'profiles.pending');
 async function locked(fn){
  let handle;
  try{
   const stat=await fs.lstat(dir);if(!stat.isDirectory()||stat.isSymbolicLink())fail('storage_invalid');
   handle=await fs.open(lock,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW);
   return await fn();
  }catch(e){if(e instanceof SyntheticProfileError)throw e;fail('storage_unavailable');}
  finally{if(handle){try{await handle.close();await fs.unlink(lock);}catch{fail('storage_unavailable');}}}
 }
 async function readAll(){
  let handle;
  try{handle=await fs.open(file,constants.O_RDONLY|constants.O_NOFOLLOW);}catch(e){throw e;}
  let bytes;
  try{const stat=await handle.stat();if(!stat.isFile()||stat.size>LIMIT)fail('storage_invalid');
   const buffer=Buffer.alloc(LIMIT+1);let offset=0;
   while(offset<buffer.length){const {bytesRead}=await handle.read(buffer,offset,buffer.length-offset,offset);if(bytesRead===0)break;offset+=bytesRead;}
   if(offset>LIMIT)fail('storage_invalid');bytes=buffer.subarray(0,offset);
  }finally{await handle.close();}
  try{
   const data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
   if(!data||Object.keys(data).join(',')!=='format,records'||data.format!==1||!Array.isArray(data.records)||data.records.length>MAX_RECORDS)fail('storage_invalid');
   const records=[];for(const r of data.records)records.push(await validate(r));
   if(new Set(records.map(r=>r.profile_id)).size!==records.length)fail('storage_invalid');return records;
  }catch{fail('storage_invalid');}
 }
 if(initialize!==false&&initialize!==true)fail('invalid_profile_input');
 if(initialize)await locked(async()=>{const h=await fs.open(file,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW);try{await h.writeFile(JSON.stringify({format:1,records:[]}));}finally{await h.close();}});
 return Object.freeze({
  read:async id=>{if(!synthetic(id))fail('invalid_profile_input');return locked(async()=> (await readAll()).find(r=>r.profile_id===id)??null);},
  compareAndSwap:async(id,revision,next)=>{
   let record;try{record=await validate(next);if(record.profile_id!==id||!(revision===null||Number.isSafeInteger(revision)&&revision>0)||record.revision!==(revision===null?1:revision+1))fail('invalid_profile_input');}catch{fail('invalid_profile_input');}
   return locked(async()=>{
    const records=await readAll(),index=records.findIndex(r=>r.profile_id===id),old=records[index];
    if((old?.revision??null)!==revision||old?.state==='revoked')return false;
    if(old&&JSON.stringify(old.scopes)!==JSON.stringify(record.scopes))fail('invalid_profile_input');
    if(index<0)records.push(record);else records[index]=record;
    const bytes=Buffer.from(JSON.stringify({format:1,records}));if(records.length>MAX_RECORDS||bytes.length>LIMIT)fail('storage_invalid');
    let temp;try{temp=await fs.open(pending,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW);await temp.writeFile(bytes);await temp.close();temp=null;await fs.rename(pending,file);}
    finally{if(temp)await temp.close();} // Uncertain partial writes leave pending file: no blind retry.
    return true;
   });
  }
 });
}
