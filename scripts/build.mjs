// Local build only: no deployment, credentials, or network operations.
import {build} from 'esbuild';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
await mkdir('dist',{recursive:true});
await build({entryPoints:['src/worker.mjs'],outfile:'dist/worker.mjs',bundle:true,format:'esm',platform:'neutral',target:'es2022',external:['node:*'],alias:{util:'node:util'},banner:{js:'/*! PDFinder: see LICENSE and THIRD_PARTY_NOTICES.md. Includes modified Apache-2.0 PDF.js, MIT geometry, BSD-like Adobe CMaps, and OFL font data. */\nimport * as nodeUtil from "node:util"; const require=(name)=>{if(name==="node:util")return nodeUtil;throw new Error("Unsupported module");};'},minify:false,legalComments:'eof'});
const b=await readFile('dist/worker.mjs');
console.log(JSON.stringify({bytes:b.length,sha256:createHash('sha256').update(b).digest('hex'),scope:'local build, not cloud validation'}));
