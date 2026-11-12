import test from 'node:test';
import assert from 'node:assert/strict';
import {selectUniquePdfAttachment,selectGmailRawAttachment,MimeSelectionError} from '../src/gmail-mime-attachment.mjs';
import {fixedFixtures} from '../src/fixed-fixtures.mjs';
import {loadParser} from '../src/lazy-loader.mjs';
import {createSyntheticAttachmentApi} from '../src/synthetic-attachment-api.mjs';
import {makeSyntheticSearchInput} from '../src/provider-attachments.mjs';
const enc=new TextEncoder(),fixture=fixedFixtures[3];
const selection=(f=fixture,filename=f.fixture_id)=>({filename,size_bytes:f.bytes,sha256:f.sha256});
const part=(f=fixture,{name=f.fixture_id,disposition=`attachment; filename="${name}"`,type='application/pdf',encoding='base64',body=f.data.match(/.{1,76}/g).join('\r\n'),extra=''}={})=>`Content-Type: ${type}\r\nContent-Disposition: ${disposition}\r\nContent-Transfer-Encoding: ${encoding}\r\n${extra}\r\n${body}`;
const multipart=(parts,{boundary='synthetic-boundary',type='mixed'}={})=>`MIME-Version: 1.0\r\nContent-Type: multipart/${type}; boundary="${boundary}"\r\n\r\nSynthetic preamble\r\n--${boundary}\r\n${parts.join(`\r\n--${boundary}\r\n`)}\r\n--${boundary}--\r\nSynthetic epilogue`;
const envelope=(message,id='synthetic-message')=>({id,raw:btoa(String.fromCharCode(...enc.encode(message))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')});
const rejected=(code)=>e=>e instanceof MimeSelectionError&&e.message==='Selected MIME attachment unavailable'&&(!code||e.code===code);

for(const f of fixedFixtures)test(`Gmail raw MIME -> real PDF parser -> citation: ${f.fixture_id}`,async()=>{
  const payload=envelope(multipart(['Content-Type: text/html\r\n\r\n<img src="https://synthetic.invalid/never-fetch">',part(f)]));
  const original=await selectGmailRawAttachment(payload,{message_id:payload.id,...selection(f)});
  assert.equal(original.attachment_id,null);assert.deepEqual(original.mime_path,[2]);assert.equal(original.sha256,f.sha256);
  const source={source_ref:'synthetic-mime',provider:'gmail',account_ref:'synthetic-account',message_id:payload.id,attachment_id:null,filename:f.fixture_id,sha256:f.sha256};
  const api=createSyntheticAttachmentApi({sources:[source],loadParser,resolvePassword:async()=> 'SYNTHETIC-ONLY-DO-NOT-USE'});
  const query=f.fixture_id.startsWith('chinese')?'雲端':f.fixture_id==='fixture-baseline.pdf'?'中文':'PDF';
  const req=new Request('https://synthetic.invalid/v1/synthetic/search',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(makeSyntheticSearchInput({...original,source},{query,password_profile:f.encrypted?'synthetic-fixture':null}))});
  const old=globalThis.fetch;let calls=0;globalThis.fetch=()=>{calls++;throw Error('must not fetch HTML resources');};
  try {
    const response=await api.fetch(req);assert.equal(response.status,200);const result=await response.json();
    assert.equal(result.matches[0].source.attachment_id,null);assert.equal(result.matches[0].page,1);
    assert.equal(result.matches[0].quote,query);assert.equal(calls,0);
  }finally{globalThis.fetch=old;}
});
test('single-part PDF attachment is also selected',async()=>{
  assert.deepEqual((await selectUniquePdfAttachment(enc.encode(part()),selection())).mime_path,[]);
});
test('multiple attachments select only exact unique filename',async()=>{
  const result=await selectUniquePdfAttachment(enc.encode(multipart([part(fixedFixtures[0]),part(),part(fixedFixtures[2])])),selection());
  assert.deepEqual(result.mime_path,[2]);assert.equal(result.sha256,fixture.sha256);
});
test('nested mixed/alternative MIME retains unambiguous part path',async()=>{
  const nested=multipart(['Content-Type: text/plain\r\n\r\nSynthetic text',part()],{boundary:'inner',type:'alternative'});
  const result=await selectUniquePdfAttachment(enc.encode(multipart([nested])),selection());assert.deepEqual(result.mime_path,[1,2]);
});
test('CRLF, LF and observed mixed line endings preserve decoded PDF bytes',async()=>{
  for(const message of [multipart([part()]),multipart([part()]).replace(/\r\n/g,'\n'),multipart([part()]).replace(fixture.data.slice(0,76)+'\r\n',fixture.data.slice(0,76)+'\n')]) {
    assert.equal((await selectUniquePdfAttachment(enc.encode(message),selection())).sha256,fixture.sha256);
  }
});
test('folded and case-insensitive MIME headers are accepted',async()=>{
  const message=part().replace('Content-Disposition: attachment; filename=', 'CONTENT-DISPOSITION: attachment;\r\n\tfilename=');
  assert.equal((await selectUniquePdfAttachment(enc.encode(message),selection())).sha256,fixture.sha256);
});
test('UTF-8 RFC2231 filename and language tag match exactly without normalization',async()=>{
  const filename='合成-🙂.pdf',encoded=encodeURIComponent(filename);
  const message=part(fixture,{disposition:`attachment; filename*=UTF-8'zh-TW'${encoded}`});
  const result=await selectUniquePdfAttachment(enc.encode(message),selection(fixture,filename));assert.equal(result.filename,filename);
  await assert.rejects(selectUniquePdfAttachment(enc.encode(message),selection(fixture,'合成.pdf')),rejected('attachment_not_found'));
});
test('quoted semicolon filenames and equivalent name parameters are supported',async()=>{
  const filename='semi;colon.pdf',message=part(fixture,{name:filename,type:`application/pdf; name="${filename}"`});
  assert.equal((await selectUniquePdfAttachment(enc.encode(message),selection(fixture,filename))).filename,filename);
});
test('UTF8 BOM and Unicode normalization are not silently removed from filenames',async()=>{
  for(const filename of ['\ufeffname.pdf','e\u0301.pdf']) {
    const message=part(fixture,{disposition:`attachment; filename*=UTF-8''${encodeURIComponent(filename)}`});
    assert.equal((await selectUniquePdfAttachment(enc.encode(message),selection(fixture,filename))).filename,filename);
    const other=filename.startsWith('\ufeff')?'name.pdf':'é.pdf';
    await assert.rejects(selectUniquePdfAttachment(enc.encode(message),selection(fixture,other)),rejected('attachment_not_found'));
  }
});

const cases=[
  ['missing filename',()=>part(fixture,{disposition:'attachment'}),'attachment_not_found'],
  ['different filename',()=>part(fixture,{name:'other.pdf'}),'attachment_not_found'],
  ['duplicate filename',()=>multipart([part(),part()]),'attachment_not_unique'],
  ['duplicate name on non-PDF part',()=>multipart([part(),part(fixture,{type:'text/plain'})]),'attachment_not_unique'],
  ['inline target',()=>part(fixture,{disposition:`inline; filename="${fixture.fixture_id}"`}), 'unsupported_attachment'],
  ['non-PDF target',()=>part(fixture,{type:'text/plain'}),'unsupported_attachment'],
  ['attached RFC822 is not traversed',()=>part(fixture,{type:'message/rfc822'}),'unsupported_mime'],
  ['quoted-printable PDF unsupported',()=>part(fixture,{encoding:'quoted-printable'}),'invalid_attachment_encoding'],
  ['raw binary PDF unsupported',()=>part(fixture,{encoding:'binary'}),'invalid_attachment_encoding'],
  ['bad base64 character',()=>part(fixture,{body:'!'+fixture.data.slice(1)}),'invalid_attachment_encoding'],
  ['truncated base64',()=>part(fixture,{body:fixture.data.slice(0,-1)}),'invalid_attachment_encoding'],
  ['missing closing boundary',()=>multipart([part()]).replace('--synthetic-boundary--','--wrong--'),'invalid_mime'],
  ['boundary marker after close',()=>multipart([part()])+'\r\n--synthetic-boundary','invalid_mime'],
  ['bare CR',()=>part().replace('Content-Type','Bad\rContent-Type'),'invalid_mime'],
  ['duplicate Content-Type',()=>part(fixture,{extra:'Content-Type: application/pdf\r\n'}),'invalid_mime'],
  ['duplicate disposition',()=>part(fixture,{extra:`Content-Disposition: attachment; filename="${fixture.fixture_id}"\r\n`}),'invalid_mime'],
  ['orphan header fold',()=> ' folded\r\n'+part(),'invalid_mime'],
  ['malformed header',()=>part().replace('Content-Type:','Not a header'),'invalid_mime'],
  ['conflicting filename/name',()=>part(fixture,{type:'application/pdf; name="other.pdf"'}),'ambiguous_filename'],
  ['duplicate filename parameter',()=>part(fixture,{disposition:`attachment; filename="${fixture.fixture_id}"; FILENAME="${fixture.fixture_id}"`}), 'invalid_mime'],
  ['filename continuation unsupported',()=>part(fixture,{disposition:"attachment; filename*0*=UTF-8''AES-; filename*1*=256.pdf"}),'unsupported_filename'],
  ['RFC2047 filename unsupported',()=>part(fixture,{disposition:'attachment; filename="=?UTF-8?B?QQ==?="'}),'unsupported_filename'],
  ['invalid UTF8 filename',()=>part(fixture,{disposition:"attachment; filename*=UTF-8''%FF.pdf"}),'unsupported_filename'],
  ['nonUTF8 extended filename',()=>part(fixture,{disposition:"attachment; filename*=ISO-8859-1''x.pdf"}),'unsupported_filename'],
  ['filename path',()=>part(fixture,{name:'../AES-256.pdf'}),'unsupported_filename'],
  ['encoded filename path',()=>part(fixture,{disposition:"attachment; filename*=UTF-8''%2Ftmp.pdf"}),'unsupported_filename'],
  ['multipart with attachment filename',()=>multipart([part()]).replace('Synthetic preamble','Synthetic preamble').replace('\r\n\r\n','\r\nContent-Disposition: attachment; filename="container.pdf"\r\n\r\n'),'unsupported_mime'],
  ['unsupported multipart subtype',()=>multipart([part()],{type:'signed'}),'unsupported_mime'],
  ['encoded multipart container',()=>multipart([part()]).replace('\r\n\r\n','\r\nContent-Transfer-Encoding: base64\r\n\r\n'),'unsupported_mime'],
  ['overlong header line',()=>part(fixture,{extra:'X-Synthetic: '+ 'x'.repeat(999)+'\r\n'}),'invalid_mime']
];
for(const [label,message,code] of cases)test(label,async()=>{await assert.rejects(selectUniquePdfAttachment(enc.encode(message()),selection()),rejected(code));});

test('malformed padding and nonzero base64 padding bits are rejected',async()=>{
  // Existing AES-256 fixture has == padding; changing unused bits must fail.
  assert.ok(fixture.data.endsWith('=='));const at=fixture.data.length-3;
  const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const noncanonical=fixture.data.slice(0,at)+alphabet[alphabet.indexOf(fixture.data[at])+1]+fixture.data.slice(at+1);
  await assert.rejects(selectUniquePdfAttachment(enc.encode(part(fixture,{body:noncanonical})),selection()),rejected('invalid_attachment_encoding'));
});
test('unselected forwarded MIME message cannot hide a duplicate attachment',async()=>{
  const forwarded=part(fixture,{name:'forwarded.eml',type:'message/rfc822',encoding:'7bit',body:multipart([part()],{boundary:'forwarded-boundary'})});
  await assert.rejects(selectUniquePdfAttachment(enc.encode(multipart([part(),forwarded])),selection()),rejected('unsupported_mime'));
});
test('many short folds cannot bypass the wire-header byte cap after newline normalization',async()=>{
  const folded='X-Synthetic: x\r\n'+' \r\n'.repeat(6000);
  await assert.rejects(selectUniquePdfAttachment(enc.encode(part(fixture,{extra:folded})),selection()),rejected('mime_limit'));
});
test('correct size but wrong bytes or expected hash are rejected',async()=>{
  const data=Uint8Array.from(atob(fixture.data),c=>c.charCodeAt(0));data[100]^=1;
  await assert.rejects(selectUniquePdfAttachment(enc.encode(part(fixture,{body:btoa(String.fromCharCode(...data))})),selection()),rejected('attachment_integrity_failed'));
  await assert.rejects(selectUniquePdfAttachment(enc.encode(part()),{...selection(),sha256:'0'.repeat(64)}),rejected('attachment_integrity_failed'));
});
test('size, message bytes, header aggregate, depth and part count are bounded',async()=>{
  await assert.rejects(selectUniquePdfAttachment(enc.encode(part()),{...selection(),size_bytes:fixture.bytes+3}),rejected('invalid_attachment_encoding'));
  await assert.rejects(selectUniquePdfAttachment(new Uint8Array(1048577),selection()),rejected('mime_limit'));
  await assert.rejects(selectUniquePdfAttachment(enc.encode(part(fixture,{extra:Array.from({length:30},()=> 'X-Synthetic: '+'x'.repeat(600)+'\r\n').join('')})),selection()),rejected('mime_limit'));
  let deep=part();for(let i=0;i<6;i++)deep=multipart([deep],{boundary:'depth-'+i});
  await assert.rejects(selectUniquePdfAttachment(enc.encode(deep),selection()),rejected('mime_limit'));
  await assert.rejects(selectUniquePdfAttachment(enc.encode(multipart(Array.from({length:33},()=>part()))),selection()),rejected('mime_limit'));
});
test('Gmail wrapper binds message ID and never invents attachment ID',async()=>{
  const payload=envelope(multipart([part()]));
  await assert.rejects(selectGmailRawAttachment(payload,{...selection(),message_id:'synthetic-other'}));
  const result=await selectGmailRawAttachment(payload,{...selection(),message_id:payload.id,attachment_id:'synthetic-opaque-claim'});
  assert.equal(result.attachment_id,null);assert.equal(result.message_id,payload.id);
});
test('selection mutation during asynchronous hash cannot alter provenance',async()=>{
  const s={...selection(),message_id:'synthetic-message'};
  const promise=selectGmailRawAttachment(envelope(multipart([part()])),s);
  s.filename='other.pdf';s.message_id='synthetic-other';s.sha256='0'.repeat(64);
  const result=await promise;assert.equal(result.filename,fixture.fixture_id);assert.equal(result.message_id,'synthetic-message');assert.equal(result.sha256,fixture.sha256);
});
