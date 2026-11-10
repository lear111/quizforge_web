// Virtual test-only wrappers; no production diagnostics switch or source edits.
import {registerHooks} from 'node:module';
const target=new URL('../../server/host/platform/json.js',import.meta.url).href;
registerHooks({load(url,context,next){
  const result=next(url,context);if(url!==target)return result;
  let source=String(result.source);
  for(const name of ['parseJson','stringifyJson']){
    const anchor=`export function ${name}(`;
    if(!source.includes(anchor))throw Error('JSON call-count anchor changed: '+name);
    source=source.replace(anchor,`function ${name}Graph(`);
  }
  source+=`
const isPersistedRoot = value => value?.schemaVersion === 1 && value.questions && !Array.isArray(value.questions);
export function parseJson(input,options){const value=parseJsonGraph(input,options);if(isPersistedRoot(value))globalThis.__qfStateJsonProbe?.('parse');return value;}
export function stringifyJson(value,options){if(isPersistedRoot(value))globalThis.__qfStateJsonProbe?.('stringify');return stringifyJsonGraph(value,options);}
`;
  return {...result,source};
}});
