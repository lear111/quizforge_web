import {bootstrapV1} from './api-v1.js';

const v1=Object.freeze({
  api:Object.freeze({major:1,minor:0,capabilities:Object.freeze([
    'practice','editor','editor-drafts','score','manual-review','ai-grading',
    'resources','richtext','navigation','lifecycle',
  ])}),
  bootstrap:bootstrapV1,
});
const v1Outline=Object.freeze({
  api:Object.freeze({major:1,minor:1,capabilities:Object.freeze([...v1.api.capabilities,'outline-items'])}),
  bootstrap:bootstrapV1,
});
const v1ScoreOutline=Object.freeze({
  api:Object.freeze({...v1Outline.api,minor:2}),
  bootstrap:bootstrapV1,
});

// New API majors get their own bridge here; retain existing bridges for old
// extensions and frozen history. A newer minor must preserve the older contract.
const bridges=new Map([[1,[v1,v1Outline,v1ScoreOutline]]]);

export function resolveExtensionApi(version) {
  if(version===undefined)version={major:1,minor:0};
  if(!version||typeof version!=='object'||Array.isArray(version)||
      !Number.isSafeInteger(version.major)||version.major<1||
      !Number.isSafeInteger(version.minor)||version.minor<0) {
    throw Object.assign(new Error('题型页面的 API 版本声明无效，原页面和数据已保留'),{code:'INVALID_API_VERSION'});
  }
  const versions=bridges.get(version.major),bridge=versions?.[version.minor];
  if(!bridge) {
    const supported=[...bridges.values()].map(values=>{const latest=values.at(-1);return `${latest.api.major}.${latest.api.minor}`;}).join('、');
    throw Object.assign(new Error(`题型页面需要 API ${version.major}.${version.minor}，当前应用支持 API ${supported}；请使用兼容的应用版本`),{code:'UNSUPPORTED_API_VERSION'});
  }
  return bridge;
}
