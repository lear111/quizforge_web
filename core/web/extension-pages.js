// Page routes and cache ownership use the question's exact extension version.
export const sameExtension=(left,right)=>!!left&&!!right&&left.id===right.id&&left.version===right.version;
export const sameQuestionStamp=(left,right)=>!!left&&!!right&&left.revision===right.revision&&left.contentVersion===right.contentVersion&&left.packageVersion===right.packageVersion;
export function questionExtension(payload,collection,qid=payload?.question?.id){
  const extension=payload?.extension||collection?.questions?.find(row=>row.id===qid)?.type||collection?.extension;
  if(!extension||typeof extension.id!=='string'||!extension.id||typeof extension.version!=='string'||!extension.version)throw new Error('题目缺少有效的题型拓展信息');
  return extension;
}
export function collectionExtensions(collection){
  const unique=new Map();
  for(const extension of [collection?.extension,...(collection?.extensions||[]),...(collection?.questions||[]).map(row=>row.type)]){
    if(extension?.id&&extension?.version)unique.set(`${extension.id}:${extension.version}`,extension);
  }
  return [...unique.values()];
}
export function collectionHasExtension(collection,qid,extension){
  const row=collection?.questions?.find(value=>value.id===qid);
  return !!row&&sameExtension(row.type||collection.extension,extension);
}
export function extensionPageRoute(extension,packageVersion){
  return {key:`${extension.id}:${extension.version}:${packageVersion||'unversioned'}`,path:`/api/extensions/${encodeURIComponent(extension.id)}/${encodeURIComponent(extension.version)}/page`};
}
export function unusedPagePrefixes(closedPane,remainingPanes){
  const prefixes=pane=>new Set([...collectionExtensions(pane.collection),pane.payload?.extension,pane.editState?.extension].filter(extension=>extension?.id&&extension?.version).map(extension=>`${extension.id}:${extension.version}:`));
  const retained=new Set([...remainingPanes].flatMap(pane=>[...prefixes(pane)]));
  return [...prefixes(closedPane)].filter(prefix=>!retained.has(prefix));
}
