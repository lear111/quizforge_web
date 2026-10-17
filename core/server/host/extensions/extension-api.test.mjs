import test from 'node:test';
import assert from 'node:assert/strict';
import {apiVersion,requireManifestApi,requireHistoryApi} from './extension-api.js';
test('instant answer feedback requires API 1.3 and older manifests and frozen history remain accepted',()=>{
 assert.deepEqual(apiVersion(),{major:1,minor:4});
 for(const minor of [0,1,2,3]){requireManifestApi({requiresApi:{major:1,minMinor:minor}});requireHistoryApi({apiVersion:{major:1,minor}});}
 requireManifestApi({});requireHistoryApi({});requireManifestApi({requiresApi:{major:1,minMinor:3,capabilities:['answer-state','outline-items']}});
 assert.throws(()=>requireManifestApi({requiresApi:{major:1,minMinor:2,capabilities:['answer-state']}}),{code:'INVALID_API_REQUIREMENT'});
 assert.throws(()=>requireManifestApi({requiresApi:{major:1,minMinor:5}}),{code:'UNSUPPORTED_EXTENSION_API'});
 assert.throws(()=>requireHistoryApi({apiVersion:{major:1,minor:5}}),{code:'UNSUPPORTED_HISTORY_API'});
});

test('the appearance capability needs API 1.4',()=>{
 requireManifestApi({requiresApi:{major:1,minMinor:4,capabilities:['appearance','answer-state']}});requireHistoryApi({apiVersion:{major:1,minor:4}});
 assert.throws(()=>requireManifestApi({requiresApi:{major:1,minMinor:3,capabilities:['appearance']}}),{code:'INVALID_API_REQUIREMENT'});
});
