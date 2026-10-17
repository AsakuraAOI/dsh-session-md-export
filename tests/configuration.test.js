import test from 'node:test';
import assert from 'node:assert/strict';
import {Config,renderOptions} from '../index.js';
test('export defaults come from settings, explicit download menu switches take priority',()=>{
 const configured=Config({includeReasoning:true,toolResultLimit:9000,textLimit:30000});
 const a=renderOptions(new URL('http://localhost/export'),configured);
 assert.equal(a.includeReasoning,true);assert.equal(a.toolResultLimit,9000);assert.equal(a.textLimit,30000);
 const b=renderOptions(new URL('http://localhost/export?reasoning=0&system=1&toolResultLimit=1000'),configured);
 assert.equal(b.includeReasoning,false);assert.equal(b.includeSystem,true);assert.equal(b.toolResultLimit,1000);
});
