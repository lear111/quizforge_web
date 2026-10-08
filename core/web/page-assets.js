import {resolveExtensionApi} from './api-bridges.js';

// Validate before loading dependencies or replacing an existing practice/editor
// iframe. Preserve the frozen page metadata, including its selected API version.
export async function prepareExtensionAssets(assets,loadLibrary) {
  resolveExtensionApi(assets.apiVersion);
  if(Object.hasOwn(assets,'contentApi'))validateContentApi(assets.contentApi);
  const libraries=[];
  for(const dependency of assets.dependencies||[])libraries.push(await loadLibrary(dependency));
  return {...assets,libraries};
}

export function validateContentApi(value){
  const invalid=message=>{throw Object.assign(new Error(message),{code:'INVALID_CONTENT_API'});};
  if(!value||typeof value!=='object'||Array.isArray(value)||!Number.isInteger(value.major)||value.major<1||!Number.isInteger(value.minor)||value.minor<0||!Number.isInteger(value.documentFormat)||value.documentFormat<1||!['basic-v1','advanced-v1'].includes(value.documentProfile)||!Array.isArray(value.capabilities)||value.capabilities.some(capability=>typeof capability!=='string')||new Set(value.capabilities).size!==value.capabilities.length)invalid('富文本服务接口声明无效');
  const supported=value.documentProfile==='basic-v1'?['basic-formatting','images']:['basic-formatting','images','advanced-formatting','tables','math','image-resize'];
  if(value.major!==1||value.minor>0||value.documentFormat!==1||value.capabilities.some(capability=>!supported.includes(capability)))throw Object.assign(new Error('当前应用不支持此富文本服务接口'),{code:'UNSUPPORTED_CONTENT_API'});
}
