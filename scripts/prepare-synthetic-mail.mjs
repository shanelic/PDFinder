// Local deterministic output only, always inside ignored dist/synthetic-mail.
import {mkdir,lstat,readFile,writeFile} from 'node:fs/promises';
import {createSyntheticMailFixture} from '../src/synthetic-mail-fixture.mjs';
if(process.argv.length!==2)throw new Error('This script accepts no addresses, passwords or output arguments');
const dist=new URL('../dist/',import.meta.url),out=new URL('synthetic-mail/',dist);
for(const dir of [dist,out]) {
  await mkdir(dir,{recursive:false}).catch(error=>{if(error.code!=='EEXIST')throw error;});
  const stat=await lstat(dir);if(!stat.isDirectory()||stat.isSymbolicLink())throw new Error('Expected a local output directory');
}
const {emlBytes,manifest}=await createSyntheticMailFixture();
for(const [name,data] of [[manifest.eml.filename,emlBytes],['manifest.json',new TextEncoder().encode(JSON.stringify(manifest,null,2)+'\n')]]) {
  const path=new URL(name,out);
  try {await writeFile(path,data,{flag:'wx'});}
  catch(error) {
    if(error.code!=='EEXIST')throw error;
    const stat=await lstat(path);if(!stat.isFile()||stat.isSymbolicLink())throw new Error('Unexpected output file type');
    const previous=await readFile(path);
    if(previous.length!==data.length||!previous.every((b,i)=>b===data[i]))throw new Error('Existing synthetic output differs; not overwritten');
  }
}
console.log(JSON.stringify({status:'not_sent',directory:'dist/synthetic-mail',pdf:manifest.pdf,eml:manifest.eml},null,2));
