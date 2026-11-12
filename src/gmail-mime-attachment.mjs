// Conservative MIME subset for explicitly selected Gmail raw messages.
// No network, paths, MIME sniffing fallback, or opaque attachment-ID invention.
import {decodeGmailRawEnvelope} from './gmail-raw-envelope.mjs';
const MAX_MESSAGE=1048576,MAX_HEADERS=16384,MAX_PARTS=32,MAX_DEPTH=4;
const codes=new Set(['invalid_selection','invalid_mime','mime_limit','unsupported_mime','unsupported_filename','ambiguous_filename','attachment_not_found','attachment_not_unique','unsupported_attachment','invalid_attachment_encoding','attachment_size_mismatch','attachment_integrity_failed']);
export class MimeSelectionError extends Error {
  constructor(code){super('Selected MIME attachment unavailable');this.name='MimeSelectionError';this.code=codes.has(code)?code:'invalid_mime';}
}
const fail=code=>{throw new MimeSelectionError(code);};
const binary=bytes=>{let s='';for(let i=0;i<bytes.length;i+=16384)s+=String.fromCharCode(...bytes.subarray(i,i+16384));return s;};

function headersAndBody(part) {
  const end=part.indexOf('\n\n');if(end<0)fail('invalid_mime');
  if(end>MAX_HEADERS)fail('mime_limit');
  const lines=part.slice(0,end).split('\n'),unfolded=[];
  // Count CRLF-equivalent wire bytes including the separator. Normalizing many
  // folded lines must not let an originally larger header pass the 16KiB cap.
  if(end+lines.length+3>MAX_HEADERS)fail('mime_limit');
  for(const line of lines) {
    if(line.length>998 || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(line))fail('invalid_mime');
    if(/^[ \t]/.test(line)) {if(!unfolded.length)fail('invalid_mime');unfolded[unfolded.length-1]+=' '+line.trim();}
    else unfolded.push(line);
  }
  if(unfolded.length>100)fail('mime_limit');
  const headers=new Map();
  for(const line of unfolded) {
    const colon=line.indexOf(':');if(colon<1 || !/^[!-9;-~]+$/.test(line.slice(0,colon)))fail('invalid_mime');
    const key=line.slice(0,colon).toLowerCase(),value=line.slice(colon+1).trim();
    if(headers.has(key)&&['content-type','content-disposition','content-transfer-encoding','mime-version'].includes(key))fail('invalid_mime');
    headers.set(key,value);
  }
  if(headers.has('mime-version')&&headers.get('mime-version')!=='1.0')fail('unsupported_mime');
  return {headers,body:part.slice(end+2)};
}

function parameterized(value,fallback) {
  if(value===undefined)return {type:fallback,params:new Map()};
  const sections=[];let token='',quoted=false,escaped=false;
  for(const c of value) {
    if(escaped){token+=c;escaped=false;continue;}
    if(quoted&&c==='\\'){token+=c;escaped=true;continue;}
    if(c==='"')quoted=!quoted;
    if(c===';'&&!quoted){sections.push(token.trim());token='';}else token+=c;
  }
  if(quoted||escaped)fail('invalid_mime');sections.push(token.trim());
  const type=sections.shift().toLowerCase();if(!type||!/^[a-z0-9!#$&^_.+-]+(?:\/[a-z0-9!#$&^_.+-]+)?$/.test(type))fail('invalid_mime');
  const params=new Map();
  for(const section of sections) {
    const eq=section.indexOf('=');if(eq<1)fail('invalid_mime');
    const name=section.slice(0,eq).trim().toLowerCase();let value=section.slice(eq+1).trim();
    if(!/^[a-z0-9!#$&^_.+*%-]+$/.test(name)||params.has(name))fail('invalid_mime');
    if(value.startsWith('"')) {
      if(!/^"(?:[^"\\]|\\[\x20-\x7e])*"$/.test(value))fail('invalid_mime');
      value=value.slice(1,-1).replace(/\\([\x20-\x7e])/g,'$1');
    }else if(!/^[!#$%&'*+\-.^_`|~a-zA-Z0-9]+$/.test(value))fail('invalid_mime');
    params.set(name,value);
  }
  return {type,params};
}

function extendedFilename(value) {
  const match=/^utf-8'[A-Za-z-]*'(.*)$/i.exec(value);if(!match)fail('unsupported_filename');
  const bytes=[];
  for(let i=0;i<match[1].length;i++) {
    const c=match[1][i];
    if(c==='%'){const h=match[1].slice(i+1,i+3);if(!/^[0-9a-f]{2}$/i.test(h))fail('unsupported_filename');bytes.push(parseInt(h,16));i+=2;}
    else {if(!/^[A-Za-z0-9!#$&+.^_`|~-]$/.test(c))fail('unsupported_filename');bytes.push(c.charCodeAt(0));}
  }
  try{return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(new Uint8Array(bytes));}catch{fail('unsupported_filename');}
}
function filenameOf(type,disposition) {
  const names=[];
  for(const [params,key] of [[disposition.params,'filename'],[type.params,'name']]) {
    if([...params.keys()].some(k=>k.startsWith(key+'*')&&k!==key+'*'))fail('unsupported_filename');
    if(params.has(key)) {
      const name=params.get(key);if(/[^\x20-\x7e]/.test(name)||name.includes('=?'))fail('unsupported_filename');names.push(name);
    }
    if(params.has(key+'*'))names.push(extendedFilename(params.get(key+'*')));
  }
  if(!names.length)return null;
  if(names.some(n=>n!==names[0]))fail('ambiguous_filename');
  if(!names[0]||names[0].length>512||/[\x00-\x1f\x7f/\\]/.test(names[0]))fail('unsupported_filename');
  return names[0];
}

function multipartChildren(body,boundary) {
  if(!boundary||boundary.length>70||!/^[0-9A-Za-z'()+_,\-./:=? ]+$/.test(boundary)||boundary.endsWith(' '))fail('invalid_mime');
  const marker='--'+boundary,parts=[];let started=false,closed=false,current=[];
  for(const line of body.split('\n')) {
    const trimmed=line.replace(/[ \t]+$/,'');
    if(trimmed===marker||trimmed===marker+'--') {
      if(closed)fail('invalid_mime');
      if(started){parts.push(current.join('\n'));current=[];if(parts.length>MAX_PARTS)fail('mime_limit');}
      if(trimmed===marker+'--'){if(!started)fail('invalid_mime');closed=true;}
      else started=true;
    }else if(started&&!closed)current.push(line);
  }
  if(!closed||!parts.length)fail('invalid_mime');
  return parts;
}

export async function selectUniquePdfAttachment(messageBytes,selection) {
  if(!(messageBytes instanceof Uint8Array)||!messageBytes.length||messageBytes.length>MAX_MESSAGE)fail('mime_limit');
  if(!selection||typeof selection.filename!=='string'||!selection.filename||selection.filename.length>512||
    /[\x00-\x1f\x7f/\\]/.test(selection.filename)||!Number.isSafeInteger(selection.size_bytes)||selection.size_bytes<5||selection.size_bytes>MAX_MESSAGE||
    !(selection.sha256===null||typeof selection.sha256==='string'&&/^[0-9a-f]{64}$/.test(selection.sha256)))fail('invalid_selection');
  selection={filename:selection.filename,size_bytes:selection.size_bytes,sha256:selection.sha256};
  // MIME syntax may use CRLF or LF (the observed synthetic message uses both).
  // Only base64 attachment bodies are decoded, so binary PDF bytes are untouched.
  const text=binary(messageBytes).replace(/\r\n/g,'\n');if(text.includes('\r'))fail('invalid_mime');
  const candidates=[];let count=0;
  function walk(part,path,depth) {
    if(depth>MAX_DEPTH||++count>MAX_PARTS)fail('mime_limit');
    const {headers,body}=headersAndBody(part);
    const type=parameterized(headers.get('content-type'),'text/plain');
    // Do not silently hide nested MIME attachments in unsupported message/*
    // containers and then claim the requested filename is unique.
    if(type.type.startsWith('message/'))fail('unsupported_mime');
    const disposition=parameterized(headers.get('content-disposition'),'inline');
    const filename=filenameOf(type,disposition);
    const encoding=headers.get('content-transfer-encoding')?.toLowerCase()??'7bit';
    if(type.type.startsWith('multipart/')) {
      if(filename!==null||!['mixed','alternative','related'].includes(type.type.slice(10))||encoding!=='7bit')fail('unsupported_mime');
      const children=multipartChildren(body,type.params.get('boundary'));
      for(let i=0;i<children.length;i++)walk(children[i],[...path,i+1],depth+1);
    }else if(filename===selection.filename)candidates.push({type:type.type,disposition:disposition.type,encoding,body,path});
  }
  walk(text,[],0);
  if(!candidates.length)fail('attachment_not_found');if(candidates.length!==1)fail('attachment_not_unique');
  const part=candidates[0];if(part.type!=='application/pdf'||part.disposition!=='attachment')fail('unsupported_attachment');
  if(part.encoding!=='base64')fail('invalid_attachment_encoding');
  const encoded=part.body.replace(/[ \t\n]/g,'');
  if(encoded.length!==4*Math.ceil(selection.size_bytes/3)||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded))fail('invalid_attachment_encoding');
  let decoded;try{decoded=atob(encoded);}catch{fail('invalid_attachment_encoding');}
  if(btoa(decoded)!==encoded)fail('invalid_attachment_encoding');
  if(decoded.length!==selection.size_bytes)fail('attachment_size_mismatch');
  if(!decoded.startsWith('%PDF-'))fail('unsupported_attachment');
  const bytes=Uint8Array.from(decoded,c=>c.charCodeAt(0));
  const sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
  if(selection.sha256!==null&&sha256!==selection.sha256){bytes.fill(0);fail('attachment_integrity_failed');}
  return {filename:selection.filename,bytes,sha256,mime_path:[...part.path],matched_by:selection.sha256===null?'unique_filename_size':'unique_filename_size_sha256'};
}

export async function selectGmailRawAttachment(payload,selection) {
  if(typeof selection?.message_id!=='string'||!selection.message_id)fail('invalid_selection');
  selection={message_id:selection.message_id,filename:selection.filename,size_bytes:selection.size_bytes,sha256:selection.sha256};
  const message=decodeGmailRawEnvelope(payload,selection.message_id);
  const attachment=await selectUniquePdfAttachment(message,selection);
  return {...attachment,message_id:selection.message_id,attachment_id:null};
}
