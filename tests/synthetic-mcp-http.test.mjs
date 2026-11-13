import test from 'node:test';
import assert from 'node:assert/strict';
import {Client,StreamableHTTPClientTransport} from '@modelcontextprotocol/client';
import {createSyntheticMcpHttp} from '../src/synthetic-mcp-http.mjs';
const url='https://synthetic.example.invalid/mcp',meta={'io.modelcontextprotocol/protocolVersion':'2026-07-28','io.modelcontextprotocol/clientCapabilities':{}};
const message=()=>({jsonrpc:'2.0',id:1,method:'tools/list',params:{_meta:structuredClone(meta)}});
const request=(body=message(),headers={})=>new Request(url,{method:'POST',headers:{'content-type':'application/json',accept:'application/json, text/event-stream','mcp-protocol-version':'2026-07-28',...headers},body:typeof body==='string'?body:JSON.stringify(body)});
for(const [era,responseMode]of [['modern','json'],['modern','sse'],['legacy','json']])test('official '+era+' client via local '+(era==='legacy'?'stateless':responseMode)+' handler',{timeout:10000},async()=>{
 const context={},endpoint=createSyntheticMcpHttp({authorize:async ctx=>ctx===context,responseMode}),types=[];
 const transport=new StreamableHTTPClientTransport(new URL(url),{fetch:async(input,init)=>{const req=new Request(input,init),method=req.method==='POST'?(await req.clone().json()).method:req.method;const response=await endpoint.fetch(req,context);types.push({method,type:response.headers.get('content-type')});return response;}});
 const client=new Client({name:'synthetic-http-test',version:'1'},{capabilities:{},...(era==='modern'?{versionNegotiation:{mode:{pin:'2026-07-28'}}}:{})});
 try{await client.connect(transport,{timeout:3000});assert.equal(client.getProtocolEra(),era);assert.equal(client.getNegotiatedProtocolVersion(),era==='modern'?'2026-07-28':'2025-11-25');const list=await client.listTools();assert.equal(list.tools.length,1);assert.deepEqual(list.tools[0].annotations,{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false});
 for(const provider of ['gmail','icloud'])for(const query of ['PDF','zzzz-no-match']){const r=await client.callTool({name:'search_synthetic_selected_pdf',arguments:{selection_ref:'synthetic-'+provider,query}},{timeout:3000});assert.equal(r.isError,false);assert.deepEqual(JSON.parse(r.content[0].text),r.structuredContent);assert.equal(r.structuredContent.status,query==='PDF'?'matches_found':'no_match');if(query==='PDF')assert.equal(r.structuredContent.matches[0].source.provider,provider);}
 const calls=types.filter(t=>t.method==='tools/call');assert.equal(calls.length,4);assert.ok(calls.every(t=>t.type?.includes(era==='legacy'||responseMode==='sse'?'text/event-stream':'application/json')));
 }finally{await client.close();await endpoint.close();}
});
test('trusted host context is mandatory; headers and JSON cannot authenticate',async()=>{
 const context={},endpoint=createSyntheticMcpHttp({authorize:async ctx=>ctx===context});try{const m=message();m.params._meta.authenticated=true;const r=await endpoint.fetch(request(m,{authorization:'Bearer DO-NOT-LEAK','x-authenticated':'true'}),{authenticated:true});assert.equal(r.status,401);assert.deepEqual(await r.json(),{error:'authentication_failed'});}finally{await endpoint.close();}
});
test('authorization throws or nonboolean result fail closed and redact',async()=>{for(const authorize of [async()=>{throw Error('DO-NOT-LEAK');},async()=>({authorized:true})]){const endpoint=createSyntheticMcpHttp({authorize});try{const r=await endpoint.fetch(request(),{});assert.equal(r.status,401);assert.deepEqual(await r.json(),{error:'authentication_failed'});}finally{await endpoint.close();}}});
test('wrong URL and explicit cross origin rejected before authorization',async()=>{let calls=0;const endpoint=createSyntheticMcpHttp({authorize:async()=>{calls++;return true;}});try{for(const req of [new Request('https://other.invalid/mcp'),request(message(),{origin:'https://other.invalid'})])assert.equal((await endpoint.fetch(req,{})).status,403);assert.equal(calls,0);}finally{await endpoint.close();}});
for(const kind of ['missing capabilities','version mismatch','malformed JSON','oversize'])test('SDK rejects '+kind+' without legacy fallback',async()=>{
 const endpoint=createSyntheticMcpHttp({authorize:async()=>true});try{let m=message(),headers={};if(kind==='missing capabilities')delete m.params._meta['io.modelcontextprotocol/clientCapabilities'];if(kind==='version mismatch')headers['mcp-protocol-version']='2025-11-25';if(kind==='malformed JSON')m='{';if(kind==='oversize')m='x'.repeat(32769);const r=await endpoint.fetch(request(m,headers),{});const value=await r.json();assert.ok(r.status>=400||value.error);assert.equal(value.result,undefined);if(kind==='oversize')assert.equal(r.status,413);if(kind==='missing capabilities'||kind==='version mismatch')assert.ok(value.error); }finally{await endpoint.close();}
});
test('abort before handler and during auth never starts SDK work',async()=>{
 const controller=new AbortController();controller.abort();let calls=0;const endpoint=createSyntheticMcpHttp({authorize:async()=>{calls++;return true;}});try{const req=new Request(request(),{signal:controller.signal});assert.equal((await endpoint.fetch(req,{})).status,499);assert.equal(calls,0);}finally{await endpoint.close();}
 let release,started;const gate=new Promise(r=>release=r),start=new Promise(r=>started=r),second=new AbortController(),pendingEndpoint=createSyntheticMcpHttp({authorize:async()=>{started();await gate;return true;}});try{const pending=pendingEndpoint.fetch(new Request(request(),{signal:second.signal}),{});await start;second.abort();release();assert.equal((await pending).status,499);}finally{release();await pendingEndpoint.close();}
});
test('close rejects new calls and calls still awaiting authorization',async()=>{
 let release,started;const gate=new Promise(r=>release=r),start=new Promise(r=>started=r),endpoint=createSyntheticMcpHttp({authorize:async()=>{started();await gate;return true;}});const pending=endpoint.fetch(request(),{});await start;await endpoint.close();release();assert.equal((await pending).status,503);assert.equal((await endpoint.fetch(request(),{})).status,503);
});
