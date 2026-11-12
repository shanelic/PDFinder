import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeIcloudAttachmentEnvelope} from '../src/icloud-attachment-envelope.mjs';
import {createSelectedAttachmentAdapter,makeSyntheticSearchInput} from '../src/provider-attachments.mjs';
import {createSyntheticAttachmentApi} from '../src/synthetic-attachment-api.mjs';
import {loadParser} from '../src/lazy-loader.mjs';
import {fixedFixtures} from '../src/fixed-fixtures.mjs';
const f=fixedFixtures[3],uuid='00000000-0000-0000-0000-000000000001';
const selection={message_id:'synthetic-message',attachment_id:'1.2',filename:f.fixture_id,size_bytes:f.bytes};
const payload=()=>({id:selection.message_id,body_html:'Synthetic HTML',body_truncated:false,headers_truncated:false,attachments:[
  {id:'1.1',filename:'synthetic-other.txt',mime_type:'text/plain',size:2,is_inline:false,file:null},
  {id:'1.2',filename:f.fixture_id,mime_type:'application/pdf',size:f.bytes,content_id:null,is_inline:false,file:{
    download_url:`https://sdmntprsynthetic.oaiusercontent.com/files/${uuid}/raw?synthetic=not-a-token`,file_id:'file_'+uuid.replace(/-/g,''),mime_type:'application/pdf',file_name:f.fixture_id
  }}
]});
const reject=value=>assert.throws(()=>decodeIcloudAttachmentEnvelope(value,selection),e=>e.name==='AttachmentBoundaryError'&&e.message==='Selected attachment unavailable');
test('observed original-file fields bind exact message and attachment',()=>{
  const p=payload(),d=decodeIcloudAttachmentEnvelope(p,selection);
  assert.deepEqual(d.identity,selection);assert.equal(d.kind,'icloud_original_file');assert.equal(d.original_truncated,false);
  assert.equal(d.reference.file_id,p.attachments[1].file.file_id);assert.equal(Object.isFrozen(d.reference),true);
  p.attachments[1].file.download_url='changed';assert.notEqual(d.reference.download_url,'changed');
});
test('HTML truncation does not masquerade as attachment truncation',()=>{
  const p=payload();p.body_truncated=true;p.body_unavailable=true;
  assert.equal(decodeIcloudAttachmentEnvelope(p,selection).identity.size_bytes,f.bytes);
});
for(const [label,mutate] of [
  ['wrong message',p=>p.id='synthetic-other'],['upstream error',p=>p.error='DO-NOT-LEAK'],
  ['no attachments',p=>p.attachments=[]],['duplicate ID',p=>p.attachments.push(p.attachments[1])],
  ['sparse metadata',p=>p.attachments=new Array(1)],['wrong filename',p=>p.attachments[1].filename='other.pdf'],
  ['wrong size',p=>p.attachments[1].size++],['wrong MIME',p=>p.attachments[1].mime_type='text/plain'],
  ['inline content',p=>p.attachments[1].is_inline=true],['no file yet',p=>p.attachments[1].file=null],
  ['other downloaded attachment',p=>p.attachments[0].file=p.attachments[1].file],
  ['wrong file name',p=>p.attachments[1].file.file_name='other.pdf'],
  ['wrong file MIME',p=>p.attachments[1].file.mime_type='text/plain'],
  ['wrong file ID',p=>p.attachments[1].file.file_id='file_'+'2'.repeat(32)],
  ['unapproved host',p=>p.attachments[1].file.download_url='https://example.invalid/files/'+uuid+'/raw'],
  ['HTTP scheme',p=>p.attachments[1].file.download_url=p.attachments[1].file.download_url.replace('https:','http:')],
  ['URL credentials',p=>p.attachments[1].file.download_url=p.attachments[1].file.download_url.replace('https://','https://user@')],
  ['fragment',p=>p.attachments[1].file.download_url+='#extra'],
  ['unrecognized route',p=>p.attachments[1].file.download_url=p.attachments[1].file.download_url.replace('/raw','/preview')]
])test(label,()=>{const p=payload();mutate(p);reject(p);});
test('synthetic observed-shape envelope -> file stream -> real parser -> citation',async()=>{
  // Provider attachment IDs are opaque. The existing API fixture source uses a
  // synthetic ID rather than asserting that a numeric MIME path is a provider ID.
  const source={source_ref:'synthetic-icloud-envelope',provider:'icloud',account_ref:'synthetic-account',message_id:'synthetic-message',attachment_id:'synthetic-attachment',filename:f.fixture_id,sha256:f.sha256};
  const s={source,size_bytes:f.bytes,attachment_id_complete:true,filename_unique_in_message:false,read_attachment_supported:null};
  let reads=0;
  const adapter=createSelectedAttachmentAdapter({connection:{provider:'icloud',account_ref:'synthetic-account',connection_ref:'synthetic-connection'},
    invoke:async()=>{const p=payload();p.attachments[1].id=source.attachment_id;return p;},
    decodeOriginal:(p,c)=>decodeIcloudAttachmentEnvelope(p,{message_id:c.selection.source.message_id,attachment_id:c.selection.source.attachment_id,filename:c.selection.source.filename,size_bytes:c.selection.size_bytes}),
    readOriginal:async(reference)=>{assert.match(reference.download_url,/sdmntprsynthetic/);reads++;return(async function*(){yield Uint8Array.from(atob(f.data),c=>c.charCodeAt(0));})();}
  });
  const original=await adapter.readSelected(s);assert.equal(reads,1);
  const api=createSyntheticAttachmentApi({sources:[source],loadParser,resolvePassword:async()=> 'SYNTHETIC-ONLY-DO-NOT-USE'});
  const response=await api.fetch(new Request('https://synthetic.invalid/v1/synthetic/search',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(makeSyntheticSearchInput(original,{query:'PDF',password_profile:'synthetic-fixture'}))}));
  assert.equal(response.status,200);const result=await response.json();assert.deepEqual(result.matches[0].source,source);assert.equal(result.matches[0].quote,'PDF');
});
