import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createBoundedDocumentSearch,DocumentSearchError,DOCUMENT_LIMITS} from '../src/bounded-document-search.mjs';
import {createTextPdf} from './helpers/synthetic-text-pdf.mjs';
import {fixedFixtures} from '../src/fixed-fixtures.mjs';
import {loadParser} from '../src/lazy-loader.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const streamOf=bytes=>(async function*(){yield bytes;})();
const inputOf=(bytes,{query='PDF',profile=null}={})=>({source:{source_ref:'selected-synthetic-document',provider:'icloud',account_ref:'test-account',message_id:'opaque-message',attachment_id:'opaque-attachment',filename:'generated.pdf',sha256:hash(bytes)},
  size_bytes:bytes.length,stream:streamOf(bytes),query,password_profile:profile});
const resultOf=text=>({pages:[{page:1,text}],text_status:text?'text_found':'no_extractable_text',coverage:{assessment:'not_a_completeness_proof',status:'no_detected_resource_failure'}});
const fakeParser=async()=>async()=>resultOf('PDF');
const host=options=>createBoundedDocumentSearch({loadParser,resolvePassword:async()=> 'SYNTHETIC-ONLY-DO-NOT-USE',...options});
const rejected=(p,code)=>assert.rejects(p,e=>e instanceof DocumentSearchError&&e.code===code&&e.message==='Selected document search failed');

test('real three-page PDF search keeps page numbers and source citations',async()=>{
  const input=inputOf(createTextPdf(['First PDF','No keyword here','Last PDF']));
  const r=await host().search(input);assert.equal(r.status,'matches_found');assert.equal(r.page_count,3);
  assert.deepEqual(r.matches.map(x=>x.page),[1,3]);assert.deepEqual(r.matches[0].source,input.source);
  assert.equal(r.sha256,input.source.sha256);assert.equal(r.coverage.assessment,'not_a_completeness_proof');
});
test('real blank PDF is no_extractable_text, not a successful no_match',async()=>{
  const r=await host().search(inputOf(createTextPdf([''])));assert.equal(r.status,'no_extractable_text');assert.equal(r.page_count,1);assert.deepEqual(r.matches,[]);
});
test('real text without keyword is no_match',async()=>{
  const r=await host().search(inputOf(createTextPdf(['Other text'])));assert.equal(r.status,'no_match');assert.deepEqual(r.matches,[]);
});
test('default 20 pages succeeds; 21 pages rejects atomically',async()=>{
  const processor=host();const r=await processor.search(inputOf(createTextPdf(Array(20).fill('PDF'))));
  assert.equal(r.page_count,20);assert.equal(r.matches.length,20);assert.equal(r.search.truncated,false);
  await rejected(processor.search(inputOf(createTextPdf(Array(21).fill('PDF')))),'page_limit');
});
test('lower page cap rejects the whole document before returning earlier matches',async()=>{
  await rejected(host({limits:{max_pages:2}}).search(inputOf(createTextPdf(['PDF','PDF','PDF']))),'page_limit');
});
test('real extracted text above configured budget rejects atomically',async()=>{
  await rejected(host({limits:{max_text_utf16:10}}).search(inputOf(createTextPdf(['PDF '.repeat(10)]))),'text_limit');
});
test('real AES256 opens with fake profile and reports missing or incorrect password',async()=>{
  const f=fixedFixtures.find(f=>f.fixture_id==='AES-256.pdf'),bytes=Uint8Array.from(atob(f.data),c=>c.charCodeAt(0));
  assert.equal((await host().search(inputOf(bytes,{profile:'public-fixture'}))).status,'matches_found');
  await rejected(host().search(inputOf(bytes)),'password_required');
  await rejected(host({resolvePassword:async()=> 'PUBLIC-WRONG'}).search(inputOf(bytes,{profile:'public-fixture'})),'incorrect_password');
});
test('unknown and removed profiles never initialize parser',async()=>{
  let loads=0;const processor=host({resolvePassword:async()=>undefined,loadParser:async()=>{loads++;return fakeParser();}});
  await rejected(processor.search(inputOf(createTextPdf(['PDF']),{profile:'unavailable'})),'profile_unavailable');assert.equal(loads,0);
});
test('real malformed PDF has fixed failure, no raw parser diagnostic',async()=>{
  await rejected(host().search(inputOf(new TextEncoder().encode('%PDF-1.4\nnot a document\n%%EOF'))),'malformed_pdf');
});
test('match cap is explicitly flagged rather than silently returning complete results',async()=>{
  const r=await host().search(inputOf(createTextPdf(['PDF '.repeat(25)])));assert.equal(r.matches.length,20);assert.equal(r.search.truncated,true);
});
test('UTF16 budget differs from Unicode citation range',async()=>{
  const r=await host({limits:{max_text_utf16:6},loadParser:async()=>async()=>resultOf('A😀PDF')}).search(inputOf(createTextPdf(['PDF'])));
  assert.deepEqual(r.matches[0].range,{start:2,end:5,unit:'unicode_codepoint',end_exclusive:true});
});
test('exact 2MiB transport is accepted by boundary; above cap is rejected before reads',async()=>{
  const bytes=new Uint8Array(2097152);bytes.set(new TextEncoder().encode('%PDF-'));
  assert.equal((await host({loadParser:fakeParser}).search(inputOf(bytes))).status,'matches_found');
  const input=inputOf(createTextPdf(['PDF']));input.size_bytes=2097153;let reads=0;
  input.stream={async *[Symbol.asyncIterator](){reads++;yield bytes;}};
  await rejected(host({loadParser:fakeParser}).search(input),'input_too_large');assert.equal(reads,0);
});
for(const [name,mutate,code] of [
  ['short stream',i=>i.size_bytes++,'size_mismatch'],['extra bytes',i=>i.size_bytes--,'size_mismatch'],
  ['wrong SHA',i=>i.source.sha256='0'.repeat(64),'integrity_failed'],
  ['no iCloud attachment ID',i=>i.source.attachment_id=null,'invalid_selection'],
  ['non-PDF name',i=>i.source.filename='file.zip','invalid_selection'],
  ['path name',i=>i.source.filename='../file.pdf','invalid_selection'],
  ['empty query',i=>i.query=' ','invalid_query'],['oversized query',i=>i.query='A'.repeat(81),'invalid_query'],
  ['invalid surrogate query',i=>i.query='\ud800','invalid_query'],['profile with spaces',i=>i.password_profile='not a profile','invalid_profile'],
  ['non-stream',i=>i.stream=[],'invalid_stream'],['empty chunk',i=>i.stream=(async function*(){yield new Uint8Array();})(),'invalid_stream']
])test(name,async()=>{const input=inputOf(createTextPdf(['PDF']));mutate(input);let loads=0;await rejected(host({loadParser:async()=>{loads++;return fakeParser();}}).search(input),code);assert.equal(loads,0);});
test('non-PDF bytes rejected before resolver or parser',async()=>{
  let resolved=0;const processor=host({resolvePassword:async()=>{resolved++;return 'PUBLIC';}});
  await rejected(processor.search(inputOf(new TextEncoder().encode('not a PDF'),{profile:'public'})),'not_pdf');assert.equal(resolved,0);
});
test('too many transport fragments rejected before hashing and parsing',async()=>{
  const bytes=new Uint8Array(5000),input=inputOf(bytes);let reads=0;
  input.stream=(async function*(){for(const b of bytes){reads++;yield new Uint8Array([b]);}})();
  await rejected(host().search(input),'stream_limit');assert.equal(reads,4097);
});
test('reader/resolver errors cannot masquerade as parser decisions',async()=>{
  const error=()=>Object.assign(Error('DO-NOT-LEAK'),{name:'PasswordException',code:2});
  const input=inputOf(createTextPdf(['PDF']));input.stream=(async function*(){throw error();})();
  await rejected(host().search(input),'invalid_stream');
  await rejected(host({resolvePassword:async()=>{throw error();}}).search(inputOf(createTextPdf(['PDF']),{profile:'test'})),'profile_unavailable');
});
test('resource failure is not mislabeled no_match',async()=>{
  const parser=async()=>async()=>{throw Object.assign(Error('DO-NOT-LEAK'),{name:'TextCoverageError',code:'resource_failure'});};
  await rejected(host({loadParser:parser}).search(inputOf(createTextPdf(['PDF']))),'resource_failure');
});
test('resource failure and unknown coverage cannot become successful citations',async()=>{
  const parser=async()=>async()=>({...resultOf('PDF'),coverage:{assessment:'complete',status:'all_good'}});
  await rejected(host({loadParser:parser}).search(inputOf(createTextPdf(['PDF']))),'invalid_parser_result');
});
test('caller abort before reading has no parser or resolver calls',async()=>{
  let calls=0;const a=new AbortController();a.abort();const processor=host({loadParser:async()=>{calls++;return fakeParser();},resolvePassword:async()=>{calls++;return 'PUBLIC';}});
  await rejected(processor.search(inputOf(createTextPdf(['PDF'])),{signal:a.signal}),'request_cancelled');assert.equal(calls,0);
});
test('cancelled parser result discarded and processor reusable',async()=>{
  const a=new AbortController();let first=true,seen;
  const processor=host({loadParser:async()=>async bytes=>{seen=bytes;if(first){first=false;a.abort();}return resultOf('PDF');}});
  await rejected(processor.search(inputOf(createTextPdf(['PDF'])),{signal:a.signal}),'request_cancelled');assert.equal(seen.every(x=>x===0),true);
  assert.equal((await processor.search(inputOf(createTextPdf(['PDF'])))).status,'matches_found');
});
test('single in-flight search rejects busy and releases after failure',async()=>{
  let enter,release;const ready=new Promise(r=>enter=r),gate=new Promise(r=>release=r);let first=true;
  const processor=host({loadParser:async()=>async()=>{if(first){first=false;enter();await gate;throw Error('DO-NOT-LEAK');}return resultOf('PDF');}});
  const pending=processor.search(inputOf(createTextPdf(['PDF'])));await ready;
  await rejected(processor.search(inputOf(createTextPdf(['PDF']))),'busy');release();await rejected(pending,'parser_failed');
  assert.equal((await processor.search(inputOf(createTextPdf(['PDF'])))).status,'matches_found');
});
test('detached cleanup fails closed, does not leave permanent busy state',async()=>{
  let first=true,moved;const processor=host({loadParser:async()=>async bytes=>{if(first){first=false;moved=structuredClone(bytes,{transfer:[bytes.buffer]});}return resultOf('PDF');}});
  await rejected(processor.search(inputOf(createTextPdf(['PDF']))),'cleanup_failed');moved.fill(0);
  assert.equal((await processor.search(inputOf(createTextPdf(['PDF'])))).status,'matches_found');
});
test('raw reader/resolver/parser errors are never returned',async()=>{
  const input=inputOf(createTextPdf(['PDF']));input.stream=(async function*(){throw Error('DO-NOT-LEAK https://example.invalid/?token=secret');})();
  await rejected(host().search(input),'invalid_stream');
  await rejected(host({resolvePassword:async()=>{throw Error('DO-NOT-LEAK');}}).search(inputOf(createTextPdf(['PDF']),{profile:'test'})),'profile_unavailable');
  await rejected(host({loadParser:async()=>{throw Error('DO-NOT-LEAK');}}).search(inputOf(createTextPdf(['PDF']))),'parser_failed');
});
test('host cannot exceed parser hard limits or change fixed query cap',()=>{
  assert.deepEqual(DOCUMENT_LIMITS,{max_bytes:2097152,max_pages:20,max_text_utf16:50000,max_query_codepoints:80,max_stream_chunks:4096});
  for(const limits of [{max_bytes:2097153},{max_pages:65},{max_pages:0},{max_text_utf16:100001},{max_query_codepoints:100},{unknown:1}])assert.throws(()=>host({limits}),e=>e.code==='invalid_limits');
  assert.equal(host({limits:{max_pages:64,max_text_utf16:100000}}).limits.max_pages,64);
});
