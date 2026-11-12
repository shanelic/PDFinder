import {cmapPins,readPackagedCmap} from '../vendor/cmaps/candidate-packaged-cmaps.mjs';

const STANDARD = new Set(['LiberationSans-Regular.ttf','LiberationSans-Bold.ttf','LiberationSans-BoldItalic.ttf','LiberationSans-Italic.ttf','FoxitFixed.pfb','FoxitFixedBold.pfb','FoxitFixedBoldItalic.pfb','FoxitFixedItalic.pfb','FoxitSerif.pfb','FoxitSerifBold.pfb','FoxitSerifBoldItalic.pfb','FoxitSerifItalic.pfb','FoxitDingbats.pfb','FoxitSymbol.pfb']);
const abortError=()=>new DOMException('Cancelled','AbortError');
export class TextCoverageError extends Error {
 constructor(code,issues=[]){super('Text extraction could be incomplete');this.name='TextCoverageError';this.code=code;this.issues=[...new Set(issues)];}
}
export class ExtractionLimitError extends Error {
 constructor(code){super('Extraction limit exceeded');this.name='ExtractionLimitError';this.code=code;}
}
export class PdfExtractionError extends Error {
 constructor(code){super('PDF extraction failed');this.name='PdfExtractionError';this.code=code;}
}

// Host-injected loaders are for tests only. No path or URL is a caller input.
export function createResourcePolicy({loadBytes=readPackagedCmap,signal,guarded=p=>p}={}) {
 let active=true,requests=0,delivered=0,inflight=0;
 const failures=new Set(),fallbacks=new Set(),used=new Set(),cache=new Map();
 const alive=()=>{if(!active||signal?.aborted)throw abortError();};
 const fail=code=>{failures.add(code);throw new Error('Packaged resource unavailable');};
 class StandardFontFallback extends Error {}
 class BinaryDataFactory {
  async fetch(input){
   inflight++;
   try {return await this.#fetchChecked(input);}
   catch(e){
    alive();
    if(e instanceof StandardFontFallback)throw new Error('Standard font fallback required');
    if(!failures.size)failures.add('resource_processing_failed');
    throw new Error('Packaged resource unavailable');
   } finally {inflight--;}
  }
  async #fetchChecked(input){
   alive();
   if(++requests>32)fail('resource_request_limit');
   if(!input||typeof input.kind!=='string'||typeof input.filename!=='string')fail('invalid_resource_request');
   const {kind,filename}=input;
   if(kind==='standardFontDataUrl'&&STANDARD.has(filename)){
    fallbacks.add(filename);throw new StandardFontFallback();
   }
   if(kind!=='cMapUrl')fail('unsupported_resource_kind');
   if(!Object.hasOwn(cmapPins,filename))fail('unsupported_cmap');
   if(!cache.has(filename))cache.set(filename,(async()=>{
    try {
     let value;
     try {value=await guarded(Promise.resolve().then(()=>loadBytes(filename)));}
     catch {alive();return fail('cmap_unavailable');}
     alive();
     const pin=cmapPins[filename];
     if(!(value instanceof Uint8Array)||value.byteLength!==pin.bytes)fail('cmap_integrity');
     // Constructor copy, never Buffer.slice(), which shares its source memory.
     const copy=new Uint8Array(value);
     const digest=await guarded(crypto.subtle.digest('SHA-256',copy));
     alive();
     const hash=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
     if(hash!==pin.sha256)fail('cmap_integrity');
     used.add(filename);return copy;
    } catch {
     alive();
     if(!failures.size)failures.add('resource_processing_failed');
     throw new Error('Packaged resource unavailable');
    }
   })());
   try {
    const bytes=await guarded(cache.get(filename));alive();
    if(delivered+bytes.byteLength>1048576)fail('resource_byte_limit');
    const result=new Uint8Array(bytes);delivered+=result.byteLength;return result;
   } catch {
    alive();
    if(!failures.size)failures.add('resource_processing_failed');
    throw new Error('Packaged resource unavailable');
   }
  }
 }
 return {
  BinaryDataFactory,
  check({requireIdle=false}={}){alive();if(requireIdle&&inflight>0)failures.add('resource_in_flight');if(failures.size)throw new TextCoverageError('resource_failure',[...failures]);},
  failures(){return [...failures];},
  summary(){return {assessment:'not_a_completeness_proof',status:fallbacks.size?'standard_font_fallback_used':'no_detected_resource_failure',requested_resources:requests,delivered_bytes:delivered,cmap_names:[...used].sort(),standard_font_fallback_count:fallbacks.size};},
  close(){active=false;cache.clear();}
 };
}

export function createGuardedExtractor(pdfjs,{loadBytes,cleanupTimeoutMs=1000}={}) {
 if(pdfjs.version!=='6.2.108')throw new Error('Pinned parser version required');
 if(!Number.isSafeInteger(cleanupTimeoutMs)||cleanupTimeoutMs<10||cleanupTimeoutMs>1000)throw new Error('Invalid cleanup bound');
 return async function extract(bytes,password,limits={pages:2,characters:2000},{signal}={}) {
  if(signal?.aborted)throw abortError();
  if(!(bytes instanceof Uint8Array)||bytes.byteLength===0||bytes.byteLength>2097152)throw new ExtractionLimitError('input_bytes');
  if(!limits||!Number.isSafeInteger(limits.pages)||limits.pages<0||limits.pages>64||!Number.isSafeInteger(limits.characters)||limits.characters<0||limits.characters>100000)throw new ExtractionLimitError('invalid_limits');
  let task,destroyPromise,primaryError=false,rejectAbort;
  const abortPromise=new Promise((_resolve,reject)=>{rejectAbort=reject;});
  // Always mark the rejection handled, including an abort before task creation.
  void abortPromise.catch(()=>{});
  const guarded=p=>signal?Promise.race([p,abortPromise]):p;
  const policy=createResourcePolicy({loadBytes,signal,guarded});
  const destroy=()=>destroyPromise??=Promise.resolve().then(()=>task?.destroy());
  const onAbort=()=>{rejectAbort(abortError());void destroy().catch(()=>{});};
  signal?.addEventListener('abort',onAbort,{once:true});
  let pages=[],result;
  try {
   if(signal?.aborted)throw abortError();
   task=pdfjs.getDocument({data:new Uint8Array(bytes),password,useWorkerFetch:false,useWasm:false,useSystemFonts:false,disableFontFace:true,stopAtErrors:true,verbosity:0,cMapPacked:true,BinaryDataFactory:policy.BinaryDataFactory});
   const document=await guarded(task.promise);policy.check();
   if(document.numPages>limits.pages)throw new ExtractionLimitError('page_limit');
   let count=0;
   for(let i=1;i<=document.numPages;i++){
    policy.check();
    const page=await guarded(document.getPage(i));
    try {
     policy.check();const content=await guarded(page.getTextContent());policy.check();
     const parts=[];
     for(const item of content.items){
      if(typeof item.str!=='string')continue;
      const piece=item.str+(item.hasEOL?'\n':' ');count+=piece.length;
      if(count>limits.characters)throw new ExtractionLimitError('text_limit');
      parts.push(piece);
     }
     pages.push({page:i,text:parts.join('').trim()});
    } finally {page.cleanup();}
   }
   policy.check({requireIdle:true});
   result={pages,text_status:pages.some(p=>p.text.length)?'text_found':'no_extractable_text',coverage:policy.summary()};
  } catch(e) {
   primaryError=true;pages=[];
   if(signal?.aborted)throw abortError();
   if(e instanceof TextCoverageError||e instanceof ExtractionLimitError)throw e;
   if(policy.failures().length)throw new TextCoverageError('resource_failure',policy.failures());
   if(e?.name==='PasswordException'&&(e.code===1||e.code===2)){
    const clean=new Error('PDF password required or incorrect');clean.name='PasswordException';clean.code=e.code;throw clean;
   }
   if(e?.message==='PDF_TEXT_INVALID_CMAP')throw new TextCoverageError('invalid_cmap',['detected_cmap_parse_error']);
   if(e?.message==='PDF_TEXT_FONT_TRANSLATION_FAILED')throw new TextCoverageError('font_translation',['font_translation_failed']);
   throw new PdfExtractionError(e?.name==='InvalidPDFException'?'malformed_pdf':'parser_error');
  } finally {
   signal?.removeEventListener('abort',onAbort);policy.close();
   let timer;
   try {
    // Bounds the caller's wait, not CPU, memory or termination of parser work.
    await Promise.race([destroy(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new PdfExtractionError('cleanup_timeout')),cleanupTimeoutMs);})]);
   } catch(e) {
    if(e instanceof PdfExtractionError&&e.code==='cleanup_timeout')throw e;
    throw new PdfExtractionError('cleanup_failed');
   } finally {clearTimeout(timer);}
  }
  if(signal?.aborted)throw abortError();
  return result;
 };
}
