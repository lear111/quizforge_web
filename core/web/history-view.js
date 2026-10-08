import {sameExtension} from './extension-pages.js';
import {resolveExtensionApi} from './api-bridges.js';

function frozenPage(record,entry){
  let page;
  if(Object.hasOwn(entry,'pageKey')){
    if(typeof entry.pageKey!=='string'||!entry.pageKey||!record.pages||!Object.hasOwn(record.pages,entry.pageKey))throw new Error('历史题目的页面引用缺失');
    page=record.pages[entry.pageKey];
    if(!page?.extension||!sameExtension(page.extension,entry.payload.extension))throw new Error('历史题目的页面与题型拓展不匹配');
  }else if(entry.page){page=entry.page;}
  else if(record.pages){throw new Error('历史题目的页面引用缺失');}
  else{page=record.page;}
  if(!page||typeof page!=='object')throw new Error('历史题目的页面数据缺失');
  if(page.extension&&!sameExtension(page.extension,entry.payload.extension||record.extension))throw new Error('历史题目的页面与题型拓展不匹配');
  resolveExtensionApi(page.apiVersion);
  return page;
}

// A history view owns its frozen order and states, independent of the live bank.
export function createHistoryView(record) {
  const entries=new Map((record.questions||[]).map(entry=>[entry.payload.question.id,entry]));
  const extension=record.collection?.extension||record.extension;
  const questions=(record.collection?.questions||[...entries.values()].map(({payload})=>({id:payload.question.id,title:payload.question.title}))).map(row=>({...row,type:entries.get(row.id)?.payload.extension||row.type||extension}));
  if(!questions.length||entries.size!==(record.questions||[]).length||entries.size!==questions.length||new Set(questions.map(row=>row.id)).size!==questions.length||questions.some(row=>!entries.has(row.id)))throw new Error('历史记录的题目数据不完整');
  // Resolve every frozen reference before replacing the current practice page.
  for(const entry of entries.values())frozenPage(record,entry);
  const states=Object.fromEntries(questions.map(row=>[row.id,entries.get(row.id).payload.state]));
  return {record,questions,states,extension,entry(qid){const entry=entries.get(qid);if(!entry)throw new Error('历史中没有对应题目');return {...entry,page:frozenPage(record,entry)};}};
}

export function historyProgress(record) {
  if(record.legacy)return `旧版记录 · 已保留 ${record.knownQuestionCount??record.questionCount} 题`;
  const status=record.status==='completed'?'已完成':record.status==='interrupted'?'已结束':'进行中';
  return `${status} · 已提交 ${record.submittedCount} / ${record.questionCount} 题${record.pendingCount?' · 待评分 '+record.pendingCount+' 题':''}`;
}
