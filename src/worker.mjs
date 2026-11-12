import {createCandidate} from './candidate-factory.mjs';
import {fixedFixtures} from './fixed-fixtures.mjs';
// No instrumentation/track argument is accepted or forwarded. This lazy import
// is invoked only after authentication, strict schema and fixture pin validation.
async function loadParser(){
 const module=await import('./lazy-loader.mjs');
 return module.loadParser();
}
const candidate=createCandidate({fixtures:fixedFixtures,loadParser});
export default Object.freeze({fetch(request,env){return candidate.fetch(request,env);}});
