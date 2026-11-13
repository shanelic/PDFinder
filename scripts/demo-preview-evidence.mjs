// OFFLINE fabricated captures only: no Cloudflare request, version verification,
// benchmark execution, authentication or live measurement is performed here.
import {validatePreviewSmokeEvidence as validate} from '../src/preview-smoke-evidence.mjs';
const input={expected:{worker_name:'synthetic-worker',preview_id:'synthetic-preview',url:'https://synthetic.example.invalid/benchmark',window_start_ms:1000,window_end_ms:2000,script_version_id:'synthetic-script-version',deployment_id:'synthetic-different-deployment'},
 capture:{transport_status:'response',http_status:200,cf_ray:'0123456789abcdef-TPE',body:{schema:'synthetic_protected_candidate_v1',parser_version:'6.2.108',fixture_id:'AES-256.pdf',sha256:'88bcd7d2be5ff65e024d6b3a5964da2a0d10b1f36cbb2616abfc60556a8fe47c',bytes:1825,password_mode:'correct',success:true,outcome:'exact_fixture_match',page_count:1,text_status:'text_found',coverage:{assessment:'not_a_completeness_proof',status:'no_detected_resource_failure',requested_resources:0,delivered_bytes:0,cmap_names:[],standard_font_fallback_count:0}}},
 telemetry:{success:true,errors:[],messages:[],result:{run:{status:'COMPLETED'},events:{count:1,events:[{timestamp:1500,$metadata:{id:'synthetic-event',type:'cf-worker-event',rayId:'0123456789abcdef',url:'https://synthetic.example.invalid/benchmark'},$workers:{eventType:'fetch',scriptName:'synthetic-worker',preview:{id:'synthetic-preview'},scriptVersion:{id:'synthetic-script-version'},requestId:'not-a-ray',outcome:'ok',cpuTimeMs:7,wallTimeMs:30},dataset:'synthetic',source:'synthetic'}]}}}};
const cases=[];
for(const [name,mutate,expected]of [
 ['fabricated_matched',()=>{},'matched'],
 ['mapping_unknown',f=>f.expected.script_version_id=null,'version_unverified'],
 ['query_pending',f=>f.telemetry.result.run.status='STARTED','query_incomplete'],
 ['cpu_missing',f=>delete f.telemetry.result.events.events[0].$workers.cpuTimeMs,'cpu_unavailable'],
 ['ambiguous_ray',f=>{f.telemetry.result.events.events.push(structuredClone(f.telemetry.result.events.events[0]));f.telemetry.result.events.count=2;},'event_ambiguous']
]){const f=structuredClone(input);mutate(f);const result=validate(f);if(result.telemetry_status!==expected)throw Error('Offline evidence demo failed');cases.push({name,result});}
console.log(JSON.stringify({synthetic_offline_only:true,live_cpu_measured:false,version_mapping_verified:false,cases,limitations:['Input provenance and expected mapping are trusted-host responsibilities','Synthetic numeric values are not Cloudflare performance results','Ray ID alone is not unique; complete query/context/version evidence required']},null,2));
