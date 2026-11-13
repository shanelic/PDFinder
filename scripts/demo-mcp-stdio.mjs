// Official SDK client over a real local subprocess pipe, not ChatGPT/mobile.
import {Client} from '@modelcontextprotocol/client';
import {StdioClientTransport} from '@modelcontextprotocol/client/stdio';
import {fileURLToPath} from 'node:url';
const transport=new StdioClientTransport({command:process.execPath,args:[fileURLToPath(new URL('./serve-synthetic-mcp.mjs',import.meta.url))],stderr:'pipe'});
transport.stderr?.resume();
const client=new Client({name:'synthetic-demo-client',version:'0.1.0'},{capabilities:{},versionNegotiation:{mode:{pin:'2026-07-28'}}});
const timeout=setTimeout(()=>{void client.close();process.exitCode=1;},15000);
try{
 await client.connect(transport);const era=client.getProtocolEra(),tools=await client.listTools();
 const cases=[];
 for(const provider of ['gmail','icloud'])for(const query of ['PDF','zzzz-no-match']){
  const result=await client.callTool({name:'search_synthetic_selected_pdf',arguments:{selection_ref:'synthetic-'+provider,query}});
  const expected=query==='PDF'?'matches_found':'no_match';if(result.isError||result.structuredContent?.status!==expected)throw Error('Synthetic stdio acceptance failed');
  cases.push({provider,status:result.structuredContent.status});
 }
 console.log(JSON.stringify({synthetic_only:true,protocol_era:era,server:client.getServerVersion(),tool_count:tools.tools.length,cases,limitations:['Local official SDK subprocess test, not ChatGPT/mobile registration','Fake host context is not user authentication','Parser fetch settings are not a network firewall']},null,2));
}finally{clearTimeout(timeout);await client.close();}
