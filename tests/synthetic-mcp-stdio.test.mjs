import test from 'node:test';
import assert from 'node:assert/strict';
import {Client} from '@modelcontextprotocol/client';
import {StdioClientTransport} from '@modelcontextprotocol/client/stdio';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const entry=fileURLToPath(new URL('../scripts/serve-synthetic-mcp.mjs',import.meta.url)),tool='search_synthetic_selected_pdf';
async function connect(t){
 const transport=new StdioClientTransport({command:process.execPath,args:[entry],stderr:'pipe'}),state={stderr:'',errors:[]};transport.stderr.on('data',b=>state.stderr+=b);
 const client=new Client({name:'official-synthetic-client',version:'0.1.0'},{capabilities:{},versionNegotiation:{mode:{pin:'2026-07-28'}}});client.onerror=e=>state.errors.push(e);
 t.after(()=>client.close());await client.connect(transport);return {client,transport,state};
}
test('official client discovers modern server and one bounded tool',{timeout:10000},async t=>{const {client}=await connect(t);assert.equal(client.getProtocolEra(),'modern');assert.equal(client.getNegotiatedProtocolVersion(),'2026-07-28');assert.equal(client.getServerVersion().name,'pdfinder-synthetic-stdio');assert.deepEqual(client.getServerCapabilities().tools,{});const list=await client.listTools();assert.equal(list.tools.length,1);assert.equal(list.tools[0].name,tool);assert.equal(list.tools[0].inputSchema.additionalProperties,false);});
for(const provider of ['gmail','icloud'])test(provider+' official subprocess tool returns real PDF citations and no-match',{timeout:10000},async t=>{const {client,state}=await connect(t);for(const query of ['PDF','zzzz-no-match']){const r=await client.callTool({name:tool,arguments:{selection_ref:'synthetic-'+provider,query}});assert.equal(r.isError,false);assert.deepEqual(JSON.parse(r.content[0].text),r.structuredContent);assert.equal(r.structuredContent.status,query==='PDF'?'matches_found':'no_match');if(query==='PDF'){assert.equal(r.structuredContent.matches[0].source.provider,provider);assert.equal(r.structuredContent.matches[0].quote,'PDF');assert.deepEqual(r.structuredContent.matches[0].range,{start:16,end:19,unit:'unicode_codepoint',end_exclusive:true});}}assert.deepEqual(state.errors,[]);assert.ok(state.stderr.split('\n').filter(Boolean).every(line=>line==='Synthetic parser diagnostic.'));});
test('wrong arguments do not become arbitrary identity/password/file authority',{timeout:10000},async t=>{const {client}=await connect(t);for(const extra of [{password:'DO-NOT-LEAK'},{account_ref:'DO-NOT-LEAK'},{filename:'arbitrary.pdf'}]){const r=await client.callTool({name:tool,arguments:{selection_ref:'synthetic-gmail',query:'PDF',...extra}});assert.equal(r.isError,true);assert.deepEqual(r.structuredContent,{error:'invalid_request'});}const unknown=await client.callTool({name:tool,arguments:{selection_ref:'synthetic-unknown',query:'PDF'}});assert.equal(unknown.isError,true);assert.equal(unknown.structuredContent.error,'selection_unavailable');});
test('unknown tool is protocol error, not fallback',{timeout:10000},async t=>{const {client}=await connect(t);await assert.rejects(client.callTool({name:'read_real_mail',arguments:{}}),e=>e.code===-32602);});
test('official client pre-cancellation rejects then normal call still works',{timeout:10000},async t=>{const {client}=await connect(t),controller=new AbortController();controller.abort();await assert.rejects(client.callTool({name:tool,arguments:{selection_ref:'synthetic-gmail',query:'PDF'}},{signal:controller.signal}));const r=await client.callTool({name:tool,arguments:{selection_ref:'synthetic-gmail',query:'PDF'}});assert.equal(r.isError,false);});
test('official client close reaps its actual subprocess',{timeout:10000},async t=>{const {client,transport}=await connect(t),pid=transport.pid;assert.equal(typeof pid,'number');await client.close();assert.throws(()=>process.kill(pid,0),e=>e.code==='ESRCH');});
test('actual stdin EOF without messages exits promptly without protocol noise',{timeout:5000},async t=>{const child=spawn(process.execPath,[entry],{stdio:['pipe','pipe','pipe']});t.after(()=>child.kill());let stdout='',stderr='';child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);const done=new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',(code,signal)=>resolve({code,signal}));});try{child.stdin.end();assert.deepEqual(await done,{code:0,signal:null});assert.equal(stdout,'');assert.equal(stderr,'');}finally{child.kill();}});
test('CLI rejects extra file/URL arguments without starting server',{timeout:5000},async t=>{const child=spawn(process.execPath,[entry,'https://DO-NOT-LEAK.invalid'],{stdio:['pipe','pipe','pipe']});t.after(()=>child.kill());let stdout='',stderr='';child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);const done=new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',resolve);});try{assert.equal(await done,2);assert.equal(stdout,'');assert.equal(stderr,'Synthetic server accepts no arguments.\n');}finally{child.kill();}});

test('server rejects actual default-client legacy initialize on the pipe',{timeout:7000},async t=>{
 const transport=new StdioClientTransport({command:process.execPath,args:[entry],stderr:'pipe'});transport.stderr.resume();
 const sent=[];const send=transport.send.bind(transport);transport.send=async message=>{sent.push(message);return send(message);};
 const client=new Client({name:'synthetic-legacy-probe',version:'0.1.0'},{capabilities:{}});t.after(()=>client.close());
 await assert.rejects(client.connect(transport,{timeout:3000}),error=>error.code===-32022&&error.data.supported.includes('2026-07-28'));
 assert.equal(sent[0].method,'initialize');assert.equal(sent[0].params.protocolVersion,'2025-11-25');assert.equal(client.getProtocolEra(),undefined);
});
test('real pipe cancellation suppresses tool response while later tools/list succeeds',{timeout:7000},async t=>{
 const child=spawn(process.execPath,[entry],{stdio:['pipe','pipe','pipe']});t.after(()=>child.kill());
 const messages=[];let buffer='',parseError=null;child.stderr.resume();
 child.stdout.on('data',chunk=>{buffer+=chunk;let at;while((at=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,at);buffer=buffer.slice(at+1);try{messages.push(JSON.parse(line));}catch(e){parseError=e;}}});
 const closed=new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',(code,signal)=>resolve({code,signal}));});
 const meta={'io.modelcontextprotocol/protocolVersion':'2026-07-28','io.modelcontextprotocol/clientCapabilities':{}};
 const waitFor=async id=>{const end=Date.now()+2500;while(Date.now()<end){if(parseError)throw parseError;const message=messages.find(m=>m.id===id);if(message)return message;await new Promise(r=>setTimeout(r,10));}throw Error('Synthetic pipe response timeout');};
 child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:1,method:'server/discover',params:{_meta:meta}})+'\n');assert.ok((await waitFor(1)).result);
 // Test harness frames only these fixed synthetic messages; SDK owns production protocol.
 const batch=[{jsonrpc:'2.0',id:2,method:'tools/call',params:{_meta:meta,name:tool,arguments:{selection_ref:'synthetic-gmail',query:'PDF'}}},
 {jsonrpc:'2.0',method:'notifications/cancelled',params:{requestId:2}},
 {jsonrpc:'2.0',id:3,method:'tools/list',params:{_meta:meta}}];
 child.stdin.write(batch.map(m=>JSON.stringify(m)).join('\n')+'\n');assert.equal((await waitFor(3)).result.tools[0].name,tool);
 await new Promise(r=>setTimeout(r,400));child.stdin.end();assert.deepEqual(await closed,{code:0,signal:null});assert.equal(parseError,null);assert.equal(messages.some(m=>m.id===2),false);
 // This proves response suppression, not hard CPU/parser cancellation.
});
