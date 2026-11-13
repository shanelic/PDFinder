// In-process Request/Response endpoint, no socket/listener/public URL.
// Host must authenticate the separately supplied context. Headers, JSON claims,
// _meta and SDK authInfo are NOT identity proof. Fixed synthetic fixtures only.
import {createMcpHandler} from '@modelcontextprotocol/server';
import {createSyntheticStdioServer} from './synthetic-mcp-stdio.mjs';
const ORIGIN='https://synthetic.example.invalid',URL=ORIGIN+'/mcp';
const reject=(status,error)=>new Response(JSON.stringify({error}),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
export function createSyntheticMcpHttp({authorize,responseMode='json'}={}){
 if(typeof authorize!=='function'||!['json','sse'].includes(responseMode))throw Error('Synthetic HTTP configuration invalid');
 let closed=false;
 const handler=createMcpHandler(createSyntheticStdioServer,{legacy:'stateless',responseMode,maxRequestBodySize:32768,keepAliveMs:0,onerror:()=>{}});
 return Object.freeze({async fetch(request,trustedContext){
  if(closed)return reject(503,'endpoint_closed');
  if(!(request instanceof Request))return reject(400,'invalid_request');
  if(request.url!==URL||(request.headers.has('origin')&&request.headers.get('origin')!==ORIGIN))return reject(403,'endpoint_rejected');
  if(request.signal.aborted)return reject(499,'request_cancelled');
  let allowed;try{allowed=await authorize(trustedContext);}catch{return reject(401,'authentication_failed');}
  if(allowed!==true)return reject(401,'authentication_failed');
  if(closed)return reject(503,'endpoint_closed');
  if(request.signal.aborted)return reject(499,'request_cancelled');
  try{return await handler.fetch(request);}catch{return reject(500,'query_failed');}
 },async close(){closed=true;await handler.close();}});
}
