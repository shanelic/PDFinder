// Generated synthetic PDFs only. This is not a file-upload or mailbox command.
import {createHash} from 'node:crypto';
import {createBoundedDocumentSearch} from '../src/bounded-document-search.mjs';
import {loadParser} from '../src/lazy-loader.mjs';
import {createTextPdf} from '../tests/helpers/synthetic-text-pdf.mjs';
const processor=createBoundedDocumentSearch({loadParser,resolvePassword:async()=>undefined});
const report=[];
for(const [name,pages] of [['three-page-match',['PDF first','other text','PDF last']],['no-match',['Other text']],['no-text',['']],['page-limit',Array(21).fill('PDF')]]){
  const bytes=createTextPdf(pages),sha256=createHash('sha256').update(bytes).digest('hex');
  const source={source_ref:'synthetic-'+name,provider:'icloud',account_ref:'synthetic-account',message_id:'synthetic-message',attachment_id:'synthetic-attachment',filename:name+'.pdf',sha256};
  try{
    const r=await processor.search({source,size_bytes:bytes.length,stream:(async function*(){yield bytes;})(),query:'PDF',password_profile:null});
    report.push({case:name,status:r.status,bytes:bytes.length,page_count:r.page_count,matching_pages:r.matches.map(m=>m.page),truncated:r.search.truncated});
  }catch(e){report.push({case:name,error:e.code});}
}
console.log(JSON.stringify({scope:'local_generated_synthetic_only',production_ready:false,limits:processor.limits,cases:report},null,2));
if(report[0]?.status!=='matches_found'||report[1]?.status!=='no_match'||report[2]?.status!=='no_extractable_text'||report[3]?.error!=='page_limit')throw Error('Synthetic document demo failed');
