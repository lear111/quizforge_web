// Each installed extension provides one type. Physical groups organize the
// library only; routing, snapshots and caches keep the extension's exact identity.
// Old readonly snapshots can still contain typeId; it identifies their frozen
// page, but does not add a type selector to active extension routes.
export const sameExtension=(left,right)=>!!left&&!!right&&left.id===right.id&&left.version===right.version&&(left.typeId||'')===(right.typeId||'')&&left.development?.folder===right.development?.folder;
export const extensionPagePrefix=extension=>`${extension.development?.folder?`development:${extension.development.folder}`:`${extension.id}:${extension.version}`}:`;
export const sameQuestionStamp=(left,right)=>!!left&&!!right&&left.revision===right.revision&&left.contentVersion===right.contentVersion&&left.packageVersion===right.packageVersion;
export function questionExtension(payload,collection,qid=payload?.question?.id){
  const extension=payload?.extension||collection?.questions?.find(row=>row.id===qid)?.type||collection?.extension;
  if(!extension||typeof extension.id!=='string'||!extension.id||typeof extension.version!=='string'||!extension.version)throw new Error('题目缺少有效的题型拓展信息');
  return extension;
}
export function collectionExtensions(collection){
  const unique=new Map();
  for(const extension of [collection?.extension,...(collection?.extensions||[]),...(collection?.questions||[]).map(row=>row.type)]){
    if(extension?.id&&extension?.version)unique.set(extensionPagePrefix(extension),extension);
  }
  return [...unique.values()];
}
export function collectionHasExtension(collection,qid,extension){
  const row=collection?.questions?.find(value=>value.id===qid);
  return !!row&&sameExtension(row.type||collection.extension,extension);
}
export function extensionPageRoute(extension,packageVersion){
  const path=typeof extension.development?.folder==='string'?`/api/development/extensions/${encodeURIComponent(extension.development.folder)}/page`:`/api/extensions/${encodeURIComponent(extension.id)}/${encodeURIComponent(extension.version)}/page`;
  return {key:`${extensionPagePrefix(extension)}${packageVersion||'unversioned'}`,path};
}
export function unusedPagePrefixes(closedPane,remainingPanes){
  const prefixes=pane=>new Set([...collectionExtensions(pane.collection),pane.payload?.extension,pane.editState?.extension].filter(extension=>extension?.id&&extension?.version).map(extensionPagePrefix));
  const retained=new Set([...remainingPanes].flatMap(pane=>[...prefixes(pane)]));
  return [...prefixes(closedPane)].filter(prefix=>!retained.has(prefix));
}
