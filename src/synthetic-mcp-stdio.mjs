// Shared local-only synthetic SDK server factory. SDK owns discovery/version/framing.
// Fake host context is NOT user authentication. No real mailbox or arbitrary input.
import {Server,ProtocolError} from '@modelcontextprotocol/server';
import {createSyntheticMcpQuery} from './synthetic-mcp-query.mjs';
import {createSyntheticHostHttp} from './synthetic-host-http.mjs';
import {createSyntheticHostQuery} from './synthetic-host-query.mjs';
import {createSyntheticPasswordProfiles,createInMemorySyntheticProfileStorage,createSyntheticProfileScope} from './synthetic-password-profiles.mjs';
import {makeSyntheticProviderResponse} from '../tests/helpers/synthetic-provider-response.mjs';
import {fixedFixtures} from './fixed-fixtures.mjs';
import {loadParser} from './lazy-loader.mjs';
export async function createSyntheticStdioServer({era='modern'}={}){
 if(!['modern','legacy'].includes(era))throw Error('Synthetic SDK era invalid');
 const profile='synthetic-stdio-profile',fixture=fixedFixtures.find(f=>f.fixture_id==='AES-256.pdf'),context=Object.freeze({});
 const fixtures=new Map(['gmail','icloud'].map(provider=>['synthetic-'+provider,makeSyntheticProviderResponse(provider,Uint8Array.from(atob(fixture.data),c=>c.charCodeAt(0)),{filename:fixture.fixture_id,profile})]));
 const profiles=createSyntheticPasswordProfiles({storage:createInMemorySyntheticProfileStorage()});await profiles.create({profile_id:profile,value_id:'fixture-aes256',scopes:[...fixtures.values()].map(f=>createSyntheticProfileScope(f.connection,f.selection.source))});
 const host=createSyntheticHostQuery({authenticate:async ctx=>ctx===context?{principal_id:'synthetic-stdio-principal',connection_ref:'synthetic-connection'}:null,
 readGrant:async(principal,ref)=>{const f=fixtures.get(ref);return principal==='synthetic-stdio-principal'&&f?{principal_id:principal,selection_ref:ref,revision:1,active:true,connection:f.connection,route:f.route,selection:{source:f.selection.source,size_bytes:f.selection.size_bytes,password_profile:profile}}:null;},
 invoke:async(_plan,ctx)=>fixtures.get('synthetic-'+ctx.connection.provider).response,
 readOriginal:async(_reference,ctx)=>(async function*(){yield fixtures.get('synthetic-'+ctx.connection.provider).bytes.slice();})(),
 loadParser,resolvePassword:async(c,id,source)=>profiles.resolverFor(c)(id,source)});
 const trustedOrigin='https://synthetic.example.invalid',http=createSyntheticHostHttp({host,trustedOrigin}),decoded=createSyntheticMcpQuery({http,trustedOrigin});
 const server=new Server({name:'pdfinder-synthetic-stdio',version:'0.1.0'},{capabilities:{tools:{}}});
 for(const method of ['tools/list','tools/call'])server.setRequestHandler(method,async(request,ctx)=>{
  // SDK already selected the wire era. Adapt legacy's absent envelope ONLY
  // for the internal decoded adapter; SDK still serializes actual legacy wire.
  const internalMeta=era==='legacy'?{'io.modelcontextprotocol/protocolVersion':'2026-07-28','io.modelcontextprotocol/clientCapabilities':server.getClientCapabilities()??{}}:{...ctx.mcpReq._meta,...ctx.mcpReq.envelope};
  const envelope=await decoded.handle({jsonrpc:'2.0',id:ctx.mcpReq.id,method,params:{...request.params,_meta:internalMeta}},context,ctx.mcpReq.signal);
  if(envelope.error)throw new ProtocolError(envelope.error.code,envelope.error.message,envelope.error.data);
  const {resultType,...result}=envelope.result;return result; // SDK supplies wire discriminator, not nested JSON-RPC.
 });
 return server;
}
