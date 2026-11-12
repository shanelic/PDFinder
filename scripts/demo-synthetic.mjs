// One in-memory normalized synthetic attachment. No mail tool or HTTP network.
import {fixedFixtures} from '../src/fixed-fixtures.mjs';
import {loadParser} from '../src/lazy-loader.mjs';
import {createSyntheticAttachmentApi} from '../src/synthetic-attachment-api.mjs';
const fixture=fixedFixtures.find(f=>f.fixture_id==='AES-256.pdf');
const source={source_ref:'synthetic-demo',provider:'gmail',account_ref:'synthetic-demo-account',
  message_id:'synthetic-demo-message',attachment_id:'synthetic-demo-attachment',filename:fixture.fixture_id,sha256:fixture.sha256};
const api=createSyntheticAttachmentApi({sources:[source],loadParser,
  resolvePassword:async profile=>profile==='synthetic-fixture'?'SYNTHETIC-ONLY-DO-NOT-USE':undefined});
const request=new Request('https://synthetic.invalid/v1/synthetic/search',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({
  source_ref:source.source_ref,filename:fixture.fixture_id,data_base64:fixture.data,sha256:fixture.sha256,
  password_profile:'synthetic-fixture',query:'PDF'
})});
const response=await api.fetch(request);
console.log(JSON.stringify({http_status:response.status,result:await response.json()},null,2));
if(!response.ok)process.exitCode=1;
