// Official client uses ONLY an in-process custom fetch; no global fetch fallback.
import {Client,StreamableHTTPClientTransport} from '@modelcontextprotocol/client';
import {createSyntheticMcpHttp} from '../src/synthetic-mcp-http.mjs';
const cases=[];
for(const era of ['modern','legacy']){
 const context=Object.freeze({}),endpoint=createSyntheticMcpHttp({authorize:async value=>value===context});const types=[];
 const transport=new StreamableHTTPClientTransport(new URL('https://synthetic.example.invalid/mcp'),{fetch:async(input,init)=>{const response=await endpoint.fetch(new Request(input,init),context);types.push(response.headers.get('content-type'));return response;}});
 const client=new Client({name:'synthetic-http-client',version:'0.1.0'},{capabilities:{},...(era==='modern'?{versionNegotiation:{mode:{pin:'2026-07-28'}}}:{})});
 try{await client.connect(transport,{timeout:5000});const tools=await client.listTools();if(tools.tools.length!==1||client.getProtocolEra()!==era)throw Error('Synthetic HTTP discovery failed');
  for(const provider of ['gmail','icloud'])for(const query of ['PDF','zzzz-no-match']){const result=await client.callTool({name:'search_synthetic_selected_pdf',arguments:{selection_ref:'synthetic-'+provider,query}},{timeout:5000});const expected=query==='PDF'?'matches_found':'no_match';if(result.isError||result.structuredContent.status!==expected)throw Error('Synthetic HTTP tool failed');cases.push({era,provider,status:result.structuredContent.status});}
 }finally{await client.close();await endpoint.close();}
 cases.push({era,observed_content_types:[...new Set(types)]});
}
console.log(JSON.stringify({synthetic_in_process_only:true,cases,limitations:['No socket, public endpoint, ChatGPT or mobile connection tested','Host callback uses fake identity, not OAuth','Legacy is SDK stateless compatibility, not persistent sessions','Cancellation/close do not guarantee hard parser stop']},null,2));
