import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeGmailRawEnvelope} from '../src/gmail-raw-envelope.mjs';
const id='synthetic-message';
const data=new TextEncoder().encode('Content-Type: text/plain\r\n\r\nSynthetic only.');
const raw=btoa(String.fromCharCode(...data)).replace(/\+/g,'-').replace(/\//g,'_');
test('observed id/raw fields decode canonical base64url with unrelated metadata ignored',()=>{
  for(const value of [raw,raw.replace(/=+$/,'')])assert.deepEqual(decodeGmailRawEnvelope({id,raw:value,thread_id:'synthetic-thread',payload:null},id),data);
});
test('different message or absent raw is rejected',()=>{
  for(const value of [{id:'synthetic-other',raw},{id},{id,raw:''},null])assert.throws(()=>decodeGmailRawEnvelope(value,id));
});
test('noncanonical and invalid base64url are rejected',()=>{
  for(const value of ['A','AB==','YW Jj','YWJj+','YQ=','YQ===','YWJj\n'])assert.throws(()=>decodeGmailRawEnvelope({id,raw:value},id));
});
test('decoded byte budget and invalid configuration are rejected',()=>{
  assert.throws(()=>decodeGmailRawEnvelope({id,raw},id,{maxBytes:data.length-1}));
  for(const maxBytes of [0,-1,1.5,1048577])assert.throws(()=>decodeGmailRawEnvelope({id,raw},id,{maxBytes}));
  assert.throws(()=>decodeGmailRawEnvelope({id,raw},''));
});
test('returns bytes only; it does not select or claim to decode an attachment',()=>{
  const result=decodeGmailRawEnvelope({id,raw},id);assert.ok(result instanceof Uint8Array);
  assert.equal(Object.hasOwn(result,'filename'),false);assert.equal(Object.hasOwn(result,'source'),false);
});
