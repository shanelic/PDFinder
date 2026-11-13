import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync,spawn} from 'node:child_process';
import {createSyntheticFileProfileStorage} from '../src/synthetic-file-profile-storage.mjs';
import {createSyntheticPasswordProfiles} from '../src/synthetic-password-profiles.mjs';
const id='synthetic-profile',scope={provider:'gmail',account_ref:'fixture@example.invalid',connection_ref:'synthetic-connection',message_id:'synthetic-message',attachment_id:null,filename:'AES-256.pdf',sha256:'88bcd7d2be5ff65e024d6b3a5964da2a0d10b1f36cbb2616abfc60556a8fe47c'};
const source={...scope,source_ref:'synthetic-source'};delete source.connection_ref;
const connection={provider:scope.provider,account_ref:scope.account_ref,connection_ref:scope.connection_ref};
const record={profile_id:id,revision:1,state:'active',value_id:'fixture-aes256',scopes:[scope]};
async function setup(t){const directory=await fs.mkdtemp(join(tmpdir(),'pdfinder-synthetic-profiles-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));const storage=await createSyntheticFileProfileStorage({directory,initialize:true});return {directory,storage,service:createSyntheticPasswordProfiles({storage})};}
const error=(promise,code)=>assert.rejects(promise,e=>e.code===code&&e.message==='Synthetic profile operation failed'&&!String(e.stack).includes('DO-NOT-LEAK'));
test('restart retains replacement and tombstone in actual fresh processes',async t=>{
 const {directory,service}=await setup(t);await service.create({profile_id:id,value_id:'fixture-aes256',scopes:[scope]});await service.replace({profile_id:id,expected_revision:1,value_id:'wrong-test-value'});
 const child=()=>JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',`import {createSyntheticFileProfileStorage as open} from ${JSON.stringify(new URL('../src/synthetic-file-profile-storage.mjs',import.meta.url).href)};console.log(JSON.stringify(await (await open({directory:process.argv[1]})).read('${id}')));`,directory],{encoding:'utf8'}));
 assert.equal(child().value_id,'wrong-test-value');await service.revoke({profile_id:id,expected_revision:2});assert.equal(child().state,'revoked');
 const reopened=await createSyntheticFileProfileStorage({directory});assert.equal(await reopened.compareAndSwap(id,null,record),false);
});
test('reopen exact scope, reuse and replacement; no cached values',async t=>{
 const {directory,service}=await setup(t);await service.create({profile_id:id,value_id:'fixture-aes256',scopes:[scope]});const other=createSyntheticPasswordProfiles({storage:await createSyntheticFileProfileStorage({directory})});
 assert.equal(await other.resolverFor(connection)(id,source),'SYNTHETIC-ONLY-DO-NOT-USE');await error(other.resolverFor(connection)(id,{...source,message_id:'synthetic-other'}),'scope_denied');
 await service.replace({profile_id:id,expected_revision:1,value_id:'wrong-test-value'});assert.equal(await other.resolverFor(connection)(id,source),'PUBLIC-WRONG-SYNTHETIC-PASSWORD');
});
test('cross-instance concurrent CAS has at most one winner',async t=>{
 const {directory,storage}=await setup(t),other=await createSyntheticFileProfileStorage({directory});const results=await Promise.allSettled([storage.compareAndSwap(id,null,record),other.compareAndSwap(id,null,record)]);assert.equal(results.filter(r=>r.status==='fulfilled'&&r.value===true).length,1);assert.equal((await storage.read(id)).revision,1);
});
test('missing database never silently resets tombstones',async t=>{const {directory,storage}=await setup(t);await fs.unlink(join(directory,'profiles.json'));await error(storage.read(id),'storage_unavailable');await error(storage.compareAndSwap(id,null,record),'storage_unavailable');});
test('explicit initialization refuses existing database',async t=>{const {directory}=await setup(t);await error(createSyntheticFileProfileStorage({directory,initialize:true}),'storage_unavailable');});
for(const [name,content] of [['invalid JSON','{'],['oversized','x'.repeat(32769)],['bad UTF8',Buffer.from([255])],['unknown schema',JSON.stringify({password:'DO-NOT-LEAK'})],['unknown value',JSON.stringify({format:1,records:[{...record,value_id:'DO-NOT-LEAK'}]})],['duplicate records',JSON.stringify({format:1,records:[record,record]})]])test(name+' fails closed',async t=>{const {directory,storage}=await setup(t);await fs.writeFile(join(directory,'profiles.json'),content);await error(storage.read(id),'storage_invalid');});
for(const field of ['value_id','password','scopes'])test('rejects arbitrary '+field,async t=>{const {storage}=await setup(t);const bad={...record,[field]:field==='scopes'?[{...scope,account_ref:'real@example.com'}]:'DO-NOT-LEAK'};await error(storage.compareAndSwap(id,null,bad),'invalid_profile_input');assert.equal(await storage.read(id),null);});
test('lock contention and stale pending file fail without retry or cleanup guessing',async t=>{const {directory,storage}=await setup(t);await fs.writeFile(join(directory,'profiles.lock'),'');await error(storage.read(id),'storage_unavailable');await fs.unlink(join(directory,'profiles.lock'));await fs.writeFile(join(directory,'profiles.pending'),'');await error(storage.compareAndSwap(id,null,record),'storage_unavailable');assert.equal(await storage.read(id),null);});
test('symlink database is not followed',async t=>{const {directory,storage}=await setup(t);await fs.rename(join(directory,'profiles.json'),join(directory,'other.json'));await fs.symlink(join(directory,'other.json'),join(directory,'profiles.json'));await error(storage.read(id),'storage_unavailable');});
test('path and filesystem failures redact details',async()=>{await error(createSyntheticFileProfileStorage({directory:'/tmp/DO-NOT-LEAK'}),'invalid_profile_input');const storage=await createSyntheticFileProfileStorage({directory:join(tmpdir(),'pdfinder-synthetic-profiles-missing')});await error(storage.read(id),'storage_unavailable');});
test('scope mutation and stale revision cannot overwrite',async t=>{const {storage}=await setup(t);await storage.compareAndSwap(id,null,record);assert.equal(await storage.compareAndSwap(id,null,record),false);await error(storage.compareAndSwap(id,1,{...record,revision:2,scopes:[{...scope,message_id:'synthetic-other'}]}),'invalid_profile_input');});
test('16-record limit fails bounded without changing prior data',async t=>{const {storage}=await setup(t);for(let i=0;i<16;i++)assert.equal(await storage.compareAndSwap('synthetic-p'+i,null,{...record,profile_id:'synthetic-p'+i}),true);await error(storage.compareAndSwap('synthetic-overflow',null,{...record,profile_id:'synthetic-overflow'}),'storage_invalid');assert.equal(await storage.read('synthetic-overflow'),null);assert.equal((await storage.read('synthetic-p0')).revision,1);});
test('tombstone cannot be replaced directly after reopen',async t=>{const {directory,storage}=await setup(t);await storage.compareAndSwap(id,null,record);await storage.compareAndSwap(id,1,{...record,revision:2,state:'revoked',value_id:null});const reopened=await createSyntheticFileProfileStorage({directory});assert.equal(await reopened.compareAndSwap(id,2,{...record,revision:3}),false);});

test('malformed unrelated record rejects the whole store',async t=>{
 const {directory,storage}=await setup(t);
 await fs.writeFile(join(directory,'profiles.json'),JSON.stringify({format:1,records:[record,{...record,profile_id:'synthetic-other',value_id:'DO-NOT-LEAK'}]}));
 await error(storage.read(id),'storage_invalid');await error(storage.compareAndSwap(id,1,{...record,revision:2}),'storage_invalid');
});
test('actual child processes competing CAS cannot both commit',{timeout:5000},async t=>{
 const {directory,storage}=await setup(t);
 const script=`import {createSyntheticFileProfileStorage as open} from ${JSON.stringify(new URL('../src/synthetic-file-profile-storage.mjs',import.meta.url).href)};
 const storage=await open({directory:process.argv[1]});process.stdout.write('READY\\n');
 process.stdin.once('data',async()=>{try{console.log(JSON.stringify({result:await storage.compareAndSwap(${JSON.stringify(id)},null,${JSON.stringify(record)})}));}catch(e){console.log(JSON.stringify({code:e.code}));}process.stdin.pause();});`;
 const children=Array.from({length:2},()=>{
  const child=spawn(process.execPath,['--input-type=module','-e',script,directory],{stdio:['pipe','pipe','pipe']});let output='',stderr='';let readyResolve;
  const ready=new Promise(r=>readyResolve=r);child.stdout.on('data',b=>{output+=b; if(output.includes('READY'))readyResolve();});child.stderr.on('data',b=>stderr+=b);
  const done=new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',code=>{if(code!==0)reject(Error('child failed'));else resolve(JSON.parse(output.trim().split('\n').at(-1)));});});
  t.after(()=>child.kill());return {child,ready,done};
 });
 await Promise.all(children.map(c=>c.ready));for(const c of children)c.child.stdin.end('go');
 const results=await Promise.all(children.map(c=>c.done));assert.equal(results.filter(r=>r.result===true).length,1);
 assert.ok(results.every(r=>r.result===true||r.result===false||r.code==='storage_unavailable'));assert.equal((await storage.read(id)).revision,1);
});
test('bounded loop handles short reads and rejects trailing non-JSON bytes',async t=>{
 const {directory,storage}=await setup(t);await storage.compareAndSwap(id,null,record);
 const handle=await fs.open(join(directory,'profiles.json'),'r'),prototype=Object.getPrototypeOf(handle),read=prototype.read;await handle.close();
 let calls=0;t.mock.method(prototype,'read',function(buffer,offset,length,position){calls++;return read.call(this,buffer,offset,Math.min(length,7),position);});
 assert.equal((await storage.read(id)).profile_id,id);assert.ok(calls>1);
 await fs.appendFile(join(directory,'profiles.json'),'DO-NOT-LEAK');await error(storage.read(id),'storage_invalid');
});
