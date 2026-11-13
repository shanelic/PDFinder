import test from 'node:test';
import assert from 'node:assert/strict';
import {validatePreviewSmokeEvidence as validate} from '../src/preview-smoke-evidence.mjs';
function fixture(){return {expected:{worker_name:'synthetic-worker',preview_id:'synthetic-preview',url:'https://synthetic.example.invalid/test',window_start_ms:1000,window_end_ms:2000,script_version_id:'synthetic-version',deployment_id:'different-deployment'},capture:{transport_status:'response',http_status:200,cf_ray:'0123456789ABCDEF-TPE',body:{schema:'synthetic_protected_candidate_v1',parser_version:'6.2.108',fixture_id:'AES-256.pdf',sha256:'88bcd7d2be5ff65e024d6b3a5964da2a0d10b1f36cbb2616abfc60556a8fe47c',bytes:1825,password_mode:'correct',success:true,outcome:'exact_fixture_match',page_count:1,text_status:'text_found',coverage:{assessment:'not_a_completeness_proof',status:'no_detected_resource_failure',requested_resources:0,delivered_bytes:0,cmap_names:[],standard_font_fallback_count:0}}},telemetry:{success:true,errors:[],messages:[],result:{run:{status:'COMPLETED'},events:{count:1,events:[{timestamp:1500,$metadata:{id:'synthetic-event',type:'cf-worker-event',rayId:'0123456789abcdef',requestId:'not-ray',url:'https://synthetic.example.invalid/test'},$workers:{eventType:'fetch',scriptName:'synthetic-worker',preview:{id:'synthetic-preview'},scriptVersion:{id:'synthetic-version'},requestId:'not-ray',outcome:'ok',cpuTimeMs:7,wallTimeMs:35},dataset:'synthetic',source:'synthetic'}]}}}};}
const event=f=>f.telemetry.result.events.events[0];
test('one exact event joins normalized ray without conflating request ID or deployment ID',()=>{assert.deepEqual(validate(fixture()),{function_status:'fixture_success',telemetry_status:'matched',cpu_ms:7,wall_ms:35,resource_signal:null});});
for(const [label,mutate,status]of [
 ['pending',f=>f.telemetry.result.run.status='STARTED','query_incomplete'],['error',f=>f.telemetry.errors.push({message:'SECRET'}),'query_failed'],['count mismatch',f=>f.telemetry.result.events.count=2,'events_incomplete'],['duplicate ray context',f=>{f.telemetry.result.events.events.push(structuredClone(event(f)));f.telemetry.result.events.count=2;},'event_ambiguous'],['truncated',f=>event(f).$workers.truncated=true,'event_truncated'],['unknown version',f=>f.expected.script_version_id=null,'version_unverified'],['deployment not version',f=>event(f).$workers.scriptVersion.id=f.expected.deployment_id,'version_mismatch'],['missing CPU',f=>delete event(f).$workers.cpuTimeMs,'cpu_unavailable'],['CPU string',f=>event(f).$workers.cpuTimeMs='0','cpu_unavailable'],['CPU NaN',f=>event(f).$workers.cpuTimeMs=NaN,'cpu_unavailable'],['wall missing',f=>delete event(f).$workers.wallTimeMs,'wall_unavailable'],['ray missing',f=>delete f.capture.cf_ray,'ray_unavailable']
])test(label,()=>{const f=fixture();mutate(f);const r=validate(f);assert.equal(r.telemetry_status,status);assert.equal(r.cpu_ms,null);assert.equal(r.wall_ms,null);});
for(const [label,mutate]of [['worker',f=>event(f).$workers.scriptName='other'],['preview',f=>event(f).$workers.preview.id='other'],['url',f=>event(f).$metadata.url+='?other'],['timestamp',f=>event(f).timestamp=999],['ray',f=>event(f).$metadata.rayId='ffffffffffffffff'],['event type',f=>event(f).$workers.eventType='cron']])test(label+' mismatch does not yield CPU',()=>{const f=fixture();mutate(f);assert.equal(validate(f).telemetry_status,'event_missing');});
test('zero CPU and wall are valid only when numeric/present',()=>{const f=fixture();event(f).$workers.cpuTimeMs=0;event(f).$workers.wallTimeMs=0;assert.equal(validate(f).cpu_ms,0);assert.equal(validate(f).wall_ms,0);});
test('HTTP403 is not inferred policy denial or parser failure',()=>{const f=fixture();f.capture.http_status=403;f.capture.body={error:'policy denied SECRET'};const r=validate(f);assert.equal(r.function_status,'http_forbidden');assert.equal(r.resource_signal,null);});
test('explicit trusted transport denial is reported separately',()=>{const f=fixture();f.capture.transport_status='policy_denied';assert.equal(validate(f).function_status,'transport_policy_denied');assert.equal(validate(f).cpu_ms,null);});
test('1102 alone does not establish CPU exhaustion',()=>{const f=fixture();f.capture.http_status=500;f.capture.body={error:1102};f.telemetry.result.events={count:0,events:[]};const r=validate(f);assert.equal(r.resource_signal,'http_1102_unattributed');assert.equal(r.cpu_ms,null);});
test('exceededCpu requires exact version matched event',()=>{const f=fixture();event(f).$workers.outcome='exceededCpu';assert.equal(validate(f).resource_signal,'platform_exceeded_cpu');f.expected.script_version_id=null;assert.equal(validate(f).resource_signal,null);});
test('query aggregate/elapsed never substituted for per-request CPU',()=>{const f=fixture();delete event(f).$workers.cpuTimeMs;f.telemetry.result.cpuTimeMs=9;f.telemetry.result.run.elapsed=4;assert.equal(validate(f).cpu_ms,null);});
test('unrelated extra event does not invent ambiguity',()=>{const f=fixture(),extra=structuredClone(event(f));extra.$workers.preview.id='other';f.telemetry.result.events.events.push(extra);f.telemetry.result.events.count=2;assert.equal(validate(f).telemetry_status,'matched');});
test('duplicate candidate with differing version is still ambiguous',()=>{const f=fixture(),extra=structuredClone(event(f));extra.$workers.scriptVersion.id='other';f.telemetry.result.events.events.push(extra);f.telemetry.result.events.count=2;assert.equal(validate(f).telemetry_status,'event_ambiguous');});
test('invalid fixture/parser response never claims success',()=>{for(const key of ['sha256','parser_version','fixture_id','bytes','outcome']){const f=fixture();f.capture.body[key]='wrong';assert.equal(validate(f).function_status,'response_unverified');}});
test('exceptions and input data never leaked',()=>{const input={get expected(){throw Error('SECRET');}};assert.equal(JSON.stringify(validate(input)).includes('SECRET'),false);assert.equal(validate(input).telemetry_status,'invalid_input');});

for(const [name,mutate]of [
 ['missing coverage',b=>delete b.coverage],['extra body field',b=>b.extra=true],['coverage extra',b=>b.coverage.extra=true],
 ['assessment',b=>b.coverage.assessment='complete'],['counter mismatch',b=>b.coverage.standard_font_fallback_count=1],
 ['resources limit',b=>b.coverage.requested_resources=33],['bytes limit',b=>b.coverage.delivered_bytes=1048577],['fallback limit',b=>b.coverage.standard_font_fallback_count=15],
 ['unknown cmap',b=>b.coverage.cmap_names=['unknown']],['duplicate cmap',b=>b.coverage.cmap_names=['Adobe-GB1-UCS2.bcmap','Adobe-GB1-UCS2.bcmap']],['sparse cmap',b=>b.coverage.cmap_names=new Array(1)]
])test('success body rejects '+name,()=>{const f=fixture();mutate(f.capture.body);assert.equal(validate(f).function_status,'response_unverified');});
for(const value of [undefined,null,12])test('required metadata id rejects '+String(value),()=>{const f=fixture();event(f).$metadata.id=value;assert.equal(validate(f).telemetry_status,'events_invalid');assert.equal(validate(f).cpu_ms,null);});
test('contradictory requestIds are rejected without comparing either to Ray',()=>{const f=fixture();event(f).$workers.requestId='different';assert.equal(validate(f).telemetry_status,'event_invalid');assert.equal(validate(f).cpu_ms,null);});
test('matching requestIds distinct from Ray are accepted',()=>{assert.equal(validate(fixture()).telemetry_status,'matched');});

for(const [name,value]of [['null',null],['empty',{}],['bad timestamp',{dataset:'synthetic',source:'synthetic',timestamp:'bad',$metadata:{id:'synthetic-log'}}],['missing dataset',{source:'synthetic',timestamp:1500,$metadata:{id:'synthetic-log'}}],['missing source',{dataset:'synthetic',timestamp:1500,$metadata:{id:'synthetic-log'}}],['missing metadata id',{dataset:'synthetic',source:'synthetic',timestamp:1500,$metadata:{}}]])test('malformed unrelated event invalidates complete list: '+name,()=>{
 const f=fixture();f.telemetry.result.events.events.push(value);f.telemetry.result.events.count=2;assert.equal(validate(f).telemetry_status,'events_invalid');assert.equal(validate(f).cpu_ms,null);
});
test('structurally valid unrelated ordinary log need not contain invocation fields',()=>{
 const f=fixture();f.telemetry.result.events.events.push({dataset:'synthetic',source:'synthetic',timestamp:1500,$metadata:{id:'synthetic-log'}});f.telemetry.result.events.count=2;assert.equal(validate(f).telemetry_status,'matched');
});

test('official source accepts object and empty string, timestamp requires numeric epoch milliseconds',()=>{
 for(const source of [{message:'synthetic log'},'']){const f=fixture();event(f).source=source;assert.equal(validate(f).telemetry_status,'matched');}
 const f=fixture();event(f).timestamp='1970-01-01T00:00:01.500Z';assert.equal(validate(f).telemetry_status,'events_invalid');
});
test('actual local candidate real PDF.js AES256 success validates without fabricated body',async()=>{
 const {createCandidate}=await import('../src/candidate-factory.mjs');const {fixedFixtures}=await import('../src/fixed-fixtures.mjs');const {loadParser}=await import('../src/lazy-loader.mjs');
 const {makeRequest,testEnv}=await import('./interface-suite.mjs');
 const candidate=createCandidate({fixtures:fixedFixtures,loadParser,now:()=>Date.parse('2026-11-11T12:00:00Z')});
 const response=await candidate.fetch(makeRequest({fixture_id:'AES-256.pdf',password_mode:'correct'}),testEnv());
 assert.equal(response.status,200);const f=fixture();f.capture.http_status=response.status;f.capture.body=await response.json();assert.equal(validate(f).function_status,'fixture_success');
});
