import {resolveExtensionApi} from './api-bridges.js';

// Validate before loading dependencies or replacing an existing practice/editor
// iframe. Preserve the frozen page metadata, including its selected API version.
export async function prepareExtensionAssets(assets,loadLibrary) {
  resolveExtensionApi(assets.apiVersion);
  const libraries=[];
  for(const dependency of assets.dependencies||[])libraries.push(await loadLibrary(dependency));
  return {...assets,libraries};
}
