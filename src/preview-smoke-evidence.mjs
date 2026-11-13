// Pure OFFLINE evidence correlation. Does not authenticate inputs or query Cloudflare.
// expected.script_version_id must come from an independently verified mapping;
// a Preview deployment ID is deliberately never used as a script version ID.
const SHA='88bcd7d2be5ff65e024d6b3a5964da2a0d10b1f36cbb2616abfc60556a8fe47c';
const record=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const id=v=>typeof v==='string'&&v.length>0&&v.length<=512&&!/[\u0000-\u001f\u007f]/u.test(v);
const number=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0;
const dense=v=>Array.isArray(v)&&Array.from({length:v.length},(_,i)=>Object.hasOwn(v,i)).every(Boolean);
const exact=(v,keys)=>record(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const bounded=(v,max)=>Number.isSafeInteger(v)&&v>=0&&v<=max;
const coverage=c=>exact(c,['assessment','status','requested_resources','delivered_bytes','cmap_names','standard_font_fallback_count'])&&
 c.assessment==='not_a_completeness_proof'&&bounded(c.requested_resources,32)&&bounded(c.delivered_bytes,1048576)&&bounded(c.standard_font_fallback_count,14)&&
 dense(c.cmap_names)&&c.cmap_names.every(n=>['Adobe-GB1-UCS2.bcmap','UniGB-UCS2-H.bcmap'].includes(n))&&new Set(c.cmap_names).size===c.cmap_names.length&&
 c.status===(c.standard_font_fallback_count?'standard_font_fallback_used':'no_detected_resource_failure');
const ray=v=>typeof v==='string'&&/^[0-9a-f]{16}(?:-[A-Z]{3})?$/i.test(v)?v.slice(0,16).toLowerCase():null;
const time=v=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0?v:NaN;
export function validatePreviewSmokeEvidence(input){
 const out={function_status:'unverified',telemetry_status:'invalid_input',cpu_ms:null,wall_ms:null,resource_signal:null};
 try{
  const {expected:e,capture:c,telemetry:t}=structuredClone(input);
  if(!record(e)||!record(c)||!id(e.worker_name)||!id(e.preview_id)||!id(e.url)||!/^https:\/\//.test(e.url)||!Number.isSafeInteger(e.window_start_ms)||!Number.isSafeInteger(e.window_end_ms)||e.window_start_ms<0||e.window_end_ms<e.window_start_ms||e.window_end_ms-e.window_start_ms>600000||!(e.script_version_id===null||id(e.script_version_id))||!(e.deployment_id===undefined||e.deployment_id===null||id(e.deployment_id)))return out;
  // Trusted transport status is host evidence, never inferred from an HTTP body.
  if(!['response','policy_denied','failed'].includes(c.transport_status))return out;
  if(c.transport_status==='policy_denied'){out.function_status='transport_policy_denied';out.telemetry_status='not_evaluated';return out;}
  if(c.transport_status==='failed'){out.function_status='transport_failed';out.telemetry_status='not_evaluated';return out;}
  if(!Number.isInteger(c.http_status)||c.http_status<100||c.http_status>599)return out;
  const b=c.body;
  out.function_status=c.http_status===403?'http_forbidden':c.http_status!==200?'http_error':'response_unverified';
  if(record(b)&&b.error===1102)out.resource_signal='http_1102_unattributed';
  if(c.http_status===200&&exact(b,['schema','parser_version','fixture_id','sha256','bytes','password_mode','success','outcome','page_count','text_status','coverage'])&&coverage(b.coverage)&&b.schema==='synthetic_protected_candidate_v1'&&b.parser_version==='6.2.108'&&b.fixture_id==='AES-256.pdf'&&b.sha256===SHA&&b.bytes===1825&&b.password_mode==='correct'&&b.success===true&&b.outcome==='exact_fixture_match'&&b.page_count===1&&b.text_status==='text_found')out.function_status='fixture_success';
  const responseRay=ray(c.cf_ray);if(!responseRay){out.telemetry_status='ray_unavailable';return out;}
  if(!record(t)||t.success!==true||!dense(t.errors)||t.errors.length!==0||!dense(t.messages)||!record(t.result)){out.telemetry_status='query_failed';return out;}
  if(t.result.run?.status==='STARTED'){out.telemetry_status='query_incomplete';return out;}
  if(t.result.run?.status!=='COMPLETED'){out.telemetry_status='query_failed';return out;}
  const events=t.result.events;
  if(!record(events)||!Number.isSafeInteger(events.count)||events.count<0||!dense(events.events)||events.events.length>1000||events.count!==events.events.length){out.telemetry_status='events_incomplete';return out;}
  // Validate the complete returned list, including unrelated log entries.
  // Invocation-only fields are checked below, not required of ordinary logs.
  if(!events.events.every(event=>record(event)&&typeof event.dataset==='string'&&(typeof event.source==='string'||record(event.source))&&Number.isFinite(time(event.timestamp))&&record(event.$metadata)&&typeof event.$metadata.id==='string')){out.telemetry_status='events_invalid';return out;}
  // A Ray ID is not guaranteed unique. First gather ALL exact context candidates,
  // before examining versions or metrics; never pick a convenient duplicate.
  const matches=events.events.filter(event=>{
   if(!record(event))return false;const m=event.$metadata,w=event.$workers,ts=time(event.timestamp);
   return record(m)&&record(w)&&m.type==='cf-worker-event'&&ray(m.rayId)===responseRay&&m.url===e.url&&w.eventType==='fetch'&&w.scriptName===e.worker_name&&w.preview?.id===e.preview_id&&Number.isFinite(ts)&&ts>=e.window_start_ms&&ts<=e.window_end_ms;
  });
  if(matches.length!==1){out.telemetry_status=matches.length?'event_ambiguous':'event_missing';return out;}
  const event=matches[0],w=event.$workers,m=event.$metadata;
  if(typeof m.id!=='string'||(m.requestId!==undefined&&!id(m.requestId))||(w.requestId!==undefined&&!id(w.requestId))||(m.requestId!==undefined&&w.requestId!==undefined&&m.requestId!==w.requestId)){out.telemetry_status='event_invalid';return out;}
  if(w.truncated!==undefined&&w.truncated!==false){out.telemetry_status='event_truncated';return out;}
  if(e.script_version_id===null){out.telemetry_status='version_unverified';return out;}
  if(!id(w.scriptVersion?.id)||w.scriptVersion.id!==e.script_version_id){out.telemetry_status='version_mismatch';return out;}
  if(w.outcome==='exceededCpu')out.resource_signal='platform_exceeded_cpu';
  if(!number(w.cpuTimeMs)){out.telemetry_status='cpu_unavailable';return out;}
  if(!number(w.wallTimeMs)){out.telemetry_status='wall_unavailable';return out;}
  if(!id(w.outcome)){out.telemetry_status='outcome_unavailable';return out;}
  out.telemetry_status='matched';out.cpu_ms=w.cpuTimeMs;out.wall_ms=w.wallTimeMs;return out;
 }catch{return out;}
}
