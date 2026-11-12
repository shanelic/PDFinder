// Local synthetic candidate. Call loadParser only after authentication and input gates.
// No eager initialization, persistent data/password cache, or hidden compatibility fallback.
let parserPromise;
export function loadParser(track=async(_name,f)=>f()){
 return parserPromise??=(async()=>{
 const geometry=await track('geometry',async()=>(await import('../vendor/canvas/geometry.js')).default);
 globalThis.DOMMatrix??=geometry.DOMMatrix;
 const {getDocument,version}=await track('api',()=>import('../vendor/pdfjs/pdf.mjs'));
 const {WorkerMessageHandler}=await track('worker',()=>import('../vendor/pdfjs/pdf.worker-native-guarded.mjs'));
 globalThis.pdfjsWorker={WorkerMessageHandler};
 const {createGuardedExtractor}=await track('adapter',()=>import('./guarded-extractor.mjs'));
 return createGuardedExtractor({getDocument,version});
 })();
}
