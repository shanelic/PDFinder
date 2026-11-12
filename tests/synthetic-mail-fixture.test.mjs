import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createSyntheticMailFixture,PUBLIC_SYNTHETIC_PASSWORD,PUBLIC_SYNTHETIC_PROFILE} from '../src/synthetic-mail-fixture.mjs';
import {selectGmailRawAttachment} from '../src/gmail-mime-attachment.mjs';
import {createSyntheticAttachmentApi} from '../src/synthetic-attachment-api.mjs';
import {loadParser} from '../src/lazy-loader.mjs';
import {makeSyntheticSearchInput} from '../src/provider-attachments.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const envelope=bytes=>({id:'synthetic-fixture-message',raw:Buffer.from(bytes).toString('base64url')});
async function originalOf(fixture) {
  const payload=envelope(fixture.emlBytes);
  return selectGmailRawAttachment(payload,{message_id:payload.id,filename:fixture.manifest.pdf.filename,size_bytes:fixture.manifest.pdf.bytes,sha256:fixture.manifest.pdf.sha256});
}
const sourceOf=original=>({source_ref:'synthetic-mail-fixture',provider:'gmail',account_ref:'synthetic-account',message_id:original.message_id,attachment_id:null,filename:original.filename,sha256:original.sha256});
const request=body=>new Request('https://synthetic.invalid/v1/synthetic/search',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});

test('same fixed fixture generates identical EML bytes and manifest',async()=>{
  const a=await createSyntheticMailFixture(),b=await createSyntheticMailFixture();
  assert.deepEqual(a,b);assert.equal(sha(a.emlBytes),a.manifest.eml.sha256);assert.equal(a.emlBytes.length,a.manifest.eml.bytes);
});
test('public fake password lineage and pinned PDF are explicit',async()=>{
  const {manifest:m}=await createSyntheticMailFixture();
  assert.equal(m.pdf.bytes,1825);assert.equal(m.pdf.sha256,'88bcd7d2be5ff65e024d6b3a5964da2a0d10b1f36cbb2616abfc60556a8fe47c');
  assert.equal(m.pdf.encryption,'AES-256');assert.equal(m.pdf.source,'src/fixed-fixtures.mjs');
  assert.deepEqual(m.password,{classification:'public_synthetic_value_not_a_secret',profile:'synthetic-fixture',value:'SYNTHETIC-ONLY-DO-NOT-USE'});
});
test('addresses are fixed invalid-domain placeholders and output is not_sent',async()=>{
  const {emlBytes,manifest:m}=await createSyntheticMailFixture(),text=new TextDecoder().decode(emlBytes);
  assert.equal(m.delivery.status,'not_sent');assert.equal(m.scope,'public_synthetic_only');
  assert.equal(m.delivery.from,'synthetic-sender@example.invalid');assert.equal(m.delivery.to,'synthetic-recipient@example.invalid');
  assert.match(text,/^From: synthetic-sender@example\.invalid\r\nTo: synthetic-recipient@example\.invalid\r\n/);
  assert.equal(text.replaceAll('\r\n','').includes('\n'),false);
});
test('no caller-provided address, password or configuration is accepted',async()=>{
  for(const args of [[{to:'person@example.com'}],[{password:'anything'}],[undefined],['anything']])
    await assert.rejects(createSyntheticMailFixture(...args),/fixed synthetic fixture/);
});
test('returned bytes and manifest do not mutate subsequent generations',async()=>{
  const before=await createSyntheticMailFixture(),changed=await createSyntheticMailFixture();
  changed.emlBytes.fill(0);changed.manifest.password.value='changed';changed.manifest.delivery.to='changed';
  assert.deepEqual(await createSyntheticMailFixture(),before);
});
test('MIME selector finds exactly the original pinned PDF without invented provider ID',async()=>{
  const fixture=await createSyntheticMailFixture(),original=await originalOf(fixture);
  assert.equal(original.bytes.length,fixture.manifest.pdf.bytes);assert.equal(sha(original.bytes),fixture.manifest.pdf.sha256);
  assert.equal(original.attachment_id,null);assert.deepEqual(original.mime_path,[2]);assert.equal(original.message_id,'synthetic-fixture-message');
});
test('prepared EML -> MIME -> real AES256 parser -> exact source citation without network',async()=>{
  const oldFetch=globalThis.fetch;let calls=0;globalThis.fetch=()=>{calls++;throw new Error('No network in synthetic test');};
  try {
    const fixture=await createSyntheticMailFixture(),original=await originalOf(fixture),source=sourceOf(original);
    let profileCalls=0;
    const api=createSyntheticAttachmentApi({sources:[source],loadParser,resolvePassword:async(profile,boundSource)=>{
      profileCalls++;assert.equal(profile,fixture.manifest.password.profile);assert.deepEqual(boundSource,source);return fixture.manifest.password.value;
    }});
    const response=await api.fetch(request(makeSyntheticSearchInput({...original,source},{query:'PDF',password_profile:PUBLIC_SYNTHETIC_PROFILE})));
    assert.equal(response.status,200);const result=await response.json();assert.equal(result.status,'matches_found');
    assert.equal(result.matches.length,1);assert.equal(result.matches[0].quote,'PDF');assert.equal(result.matches[0].page,1);
    assert.deepEqual(result.matches[0].source,source);assert.equal(result.matches[0].sha256,fixture.manifest.pdf.sha256);
    assert.equal(result.coverage.assessment,'not_a_completeness_proof');assert.equal(profileCalls,1);assert.equal(calls,0);
  } finally {globalThis.fetch=oldFetch;}
});
test('wrong and unavailable fake profile fail without returning citations',async()=>{
  const fixture=await createSyntheticMailFixture(),original=await originalOf(fixture),source=sourceOf(original);
  for(const [value,error] of [['PUBLIC-WRONG','incorrect_password'],[undefined,'password_profile_unavailable']]) {
    const api=createSyntheticAttachmentApi({sources:[source],loadParser,resolvePassword:async()=>value});
    const response=await api.fetch(request(makeSyntheticSearchInput({...original,source},{query:'PDF',password_profile:PUBLIC_SYNTHETIC_PROFILE})));
    assert.equal(response.status,422);assert.deepEqual(await response.json(),{error});
  }
  assert.equal(PUBLIC_SYNTHETIC_PASSWORD,fixture.manifest.password.value);
});
test('wrong message binding and declared PDF pin fail before extraction',async()=>{
  const fixture=await createSyntheticMailFixture(),payload=envelope(fixture.emlBytes),m=fixture.manifest.pdf;
  await assert.rejects(selectGmailRawAttachment(payload,{message_id:'synthetic-other',filename:m.filename,size_bytes:m.bytes,sha256:m.sha256}),e=>e.code==='identity_mismatch');
  await assert.rejects(selectGmailRawAttachment(payload,{message_id:payload.id,filename:m.filename,size_bytes:m.bytes,sha256:'0'.repeat(64)}),e=>e.code==='attachment_integrity_failed');
});
test('same-length tampering in the MIME attachment fails its pinned hash',async()=>{
  const fixture=await createSyntheticMailFixture();let text=new TextDecoder().decode(fixture.emlBytes);
  // Alter a later base64 character, preserving the PDF signature and wire size.
  const start=text.indexOf('Content-Transfer-Encoding: base64\r\n\r\n')+'Content-Transfer-Encoding: base64\r\n\r\n'.length;
  const index=start+40;assert.match(text[index],/[A-Za-z0-9+/]/);text=text.slice(0,index)+(text[index]==='A'?'B':'A')+text.slice(index+1);
  const changed={...fixture,emlBytes:new TextEncoder().encode(text)};
  assert.notEqual(sha(changed.emlBytes),fixture.manifest.eml.sha256);
  await assert.rejects(originalOf(changed),e=>e.code==='attachment_integrity_failed');
});
