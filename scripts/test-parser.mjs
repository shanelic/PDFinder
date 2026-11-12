import worker from '../src/worker.mjs';
import {runActualWorkerSuite} from '../tests/interface-suite.mjs';
console.log(JSON.stringify(await runActualWorkerSuite(worker),null,2));
