// CHILD PROCESS ENTRY ONLY. STDOUT exclusively belongs to SDK JSON-RPC.
// No CLI options, env configuration, file paths, credentials or arbitrary URLs.
if(process.argv.length!==2){process.stderr.write('Synthetic server accepts no arguments.\n');process.exitCode=2;}
else{
 // PDF.js emits console diagnostics during import; never write them to protocol
 // stdout or reveal arbitrary exception details. This affects this CLI only.
 for(const key of ['log','info','warn','error','debug'])console[key]=()=>process.stderr.write('Synthetic parser diagnostic.\n');
 try{
  const {serveStdio}=await import('@modelcontextprotocol/server/stdio');
  const {createSyntheticStdioServer}=await import('../src/synthetic-mcp-stdio.mjs');
  serveStdio(createSyntheticStdioServer,{legacy:'reject',onerror:()=>process.stderr.write('Synthetic MCP protocol error.\n')});
 }catch{process.stderr.write('Synthetic server initialization failed.\n');process.exitCode=1;}
}
