// End-to-end fake connector invocation only. Never sends or reads actual mail.
import {createSelectedMailSearch} from '../src/selected-mail-search.mjs';
import {createTextPdf} from '../tests/helpers/synthetic-text-pdf.mjs';
import {makeSyntheticProviderResponse} from '../tests/helpers/synthetic-provider-response.mjs';
import {fixedFixtures} from '../src/fixed-fixtures.mjs';
import {loadParser} from '../src/lazy-loader.mjs';
const encrypted=fixedFixtures.find(f=>f.fixture_id==='AES-256.pdf'),reports=[];
for(const provider of ['gmail','icloud'])for(const mode of ['first-seen-plain','known-aes256']){
  const bytes=mode==='known-aes256'?Uint8Array.from(atob(encrypted.data),c=>c.charCodeAt(0)):createTextPdf(['PDF first','Other text','PDF last']);
  const f=makeSyntheticProviderResponse(provider,bytes,{profile:mode==='known-aes256'?'public-fixture':null});
  if(mode==='first-seen-plain')f.selection.source.sha256=null;
  let calls=0;
  const bridge=createSelectedMailSearch({...f,loadParser,resolvePassword:async()=> 'SYNTHETIC-ONLY-DO-NOT-USE',
    invoke:async()=>{calls++;return f.response;},readOriginal:async()=> (async function*(){yield bytes;})()});
  const r=await bridge.search(f.selection);
  if(calls!==1||r.status!=='matches_found'||r.matches.length!==(mode==='known-aes256'?1:2))throw Error('Synthetic mail bridge demo failed');
  reports.push({provider,mode,route:r.transport.route,fake_tool_calls:calls,status:r.status,page_count:r.page_count,matching_pages:r.matches.map(x=>x.page),integrity:r.integrity.comparison});
}
console.log(JSON.stringify({scope:'local_fake_connector_only',live_mail_reads:0,mail_sent:false,production_ready:false,cases:reports},null,2));
