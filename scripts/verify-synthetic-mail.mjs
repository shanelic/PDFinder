// All inputs below are generated locally. No mail tools, external fetch or files.
import {createSyntheticMailFixture} from '../src/synthetic-mail-fixture.mjs';
import {createSyntheticMailVerifier} from '../src/synthetic-mail-verifier.mjs';
import {fixedFixtures} from '../src/fixed-fixtures.mjs';
import {loadParser} from '../src/lazy-loader.mjs';
const mail=await createSyntheticMailFixture(),fixture=fixedFixtures.find(f=>f.fixture_id===mail.manifest.pdf.filename);
const pdf=Uint8Array.from(atob(fixture.data),c=>c.charCodeAt(0));
const results=[];
for(const provider of ['gmail','icloud']){
  const source={source_ref:'local-mail-acceptance-'+provider,provider,account_ref:'synthetic-account',message_id:'synthetic-message-'+provider,
    attachment_id:provider==='gmail'?null:'synthetic-attachment',filename:fixture.fixture_id,sha256:fixture.sha256};
  const payload=provider==='gmail'?{id:source.message_id,raw:Buffer.from(mail.emlBytes).toString('base64url')}:{id:source.message_id,attachments:[{
    id:source.attachment_id,filename:source.filename,size:pdf.length,mime_type:'application/pdf',is_inline:false,
    file:{file_name:source.filename,mime_type:'application/pdf',file_id:'file_00000000000000000000000000000001',
      download_url:'https://sdmntprsynthetic.oaiusercontent.com/files/00000000-0000-0000-0000-000000000001/raw?synthetic=not-a-token'}
  }]};
  const verifier=createSyntheticMailVerifier({connection:{provider,account_ref:source.account_ref,connection_ref:'synthetic-connection'},loadParser,
    readOriginal:async()=> (async function*(){yield pdf;})()});
  results.push(await verifier.verify({source,payload}));
}
const comparable=r=>JSON.stringify(r.matches.map(({source,...match})=>match));
if(comparable(results[0])!==comparable(results[1]))throw Error('Provider fixture citations differ');
console.log(JSON.stringify({scope:'local_synthetic_responses_only',mail_sent:false,live_provider_verification:false,
  matching_hashes_and_citations:true,results:results.map(r=>r.summary)},null,2));
