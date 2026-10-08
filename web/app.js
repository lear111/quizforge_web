import {request,readResource,setAccessToken,collectionPath,questionPath,makeRequestId} from './api.js';
import {mountExtension} from './frame.js';
import {mountWhiteboard} from './whiteboard.js';
import {createWriteQueue,createDraftBuffer} from './write-queue.js';
import {createQuestionCache} from './question-cache.js';
import {consecutiveQuestionGroups} from './outline-groups.js';
import {practiceViewport} from './view-camera.js';
import {createHistoryView,historyProgress} from './history-view.js';
import {createEditorSession} from './editor-session.js';
import {mountPracticeSummary} from './practice-summary.js';
import {bindNetworkSettings} from './network-settings.js';
import {bindAiSettings} from './ai-settings.js';
import {createAiClient} from './ai-client.js';
import {createDraftFullscreen} from './draft-fullscreen.js';
import {visibleQuestions,visibleQuestionId,hasScoreSummary,navigationIndex,stateFor,contextFor} from './practice-context.js';
import {createExtensionRouter} from './extension-requests.js';
import {questionExtension,collectionHasExtension,extensionPageRoute,sameQuestionStamp,unusedPagePrefixes} from './extension-pages.js';

const $=selector=>document.querySelector(selector);
const catalog={banks:[],extensions:[]},tabs=new Map();
const questionsCache=createQuestionCache(),pagesCache=createQuestionCache({capacity:4,maxBytes:4*1024*1024});
const sdkCache=createQuestionCache({capacity:4,maxBytes:8*1024*1024});
const editorDraftPath=(pane,qid)=>`/api/editor-drafts/${encodeURIComponent(pane.id)}/${encodeURIComponent(qid)}`;
async function prepareAssets(assets){const libraries=[];for(const dependency of assets.dependencies||[]){libraries.push(await sdkCache.load(`${dependency.id}:${dependency.version}:static`,()=>request(`/api/sdk/${encodeURIComponent(dependency.id)}/${encodeURIComponent(dependency.version)}`)));}return {...assets,libraries};}
const sidebarPreferences={library:true,outline:true};
try{const saved=JSON.parse(localStorage.getItem('quizforge-sidebars')||'{}');for(const key of Object.keys(sidebarPreferences))if(typeof saved[key]==='boolean')sidebarPreferences[key]=saved[key];}catch{}
const libraryDrawer=matchMedia('(max-width:800px)'),outlineDrawer=matchMedia('(max-width:1100px)');
const phoneLayout=matchMedia('(max-width:600px)');
let listMode='bank',activeKey=null,transition=Promise.resolve(),pendingWrites=0;
const el=(tag,className,text)=>{const node=document.createElement(tag);if(className)node.className=className;if(text!=null)node.textContent=text;return node;};
function notice(message){$('#notice').textContent=message||'';$('#notice').hidden=!message;}
function failure(error){notice(error.message||String(error));}
function transitionTo(fn){const run=transition.then(async()=>{notice('');$('#previous').disabled=true;$('#next').disabled=true;try{return await fn();}finally{for(const pane of tabs.values())pane.node.inert=false;updateChrome();renderRecovery();}});transition=run.catch(()=>{});run.catch(failure);return run;}
const active=()=>tabs.get(activeKey);
const draftFullscreen=createDraftFullscreen(document,{
  canEnter:()=>{const pane=active();return pane?.view==='practice'&&pane.draftMode;},
  onChange:state=>{const shell=$('.app-shell');if(state.active&&!shell.classList.contains('draft-fullscreen'))closeDrawers();shell.classList.toggle('draft-fullscreen',state.active);for(const pane of tabs.values())pane.whiteboard?.setFullscreenState(state);},
  onError:failure,
});
function disposeScoreSummary(pane){pane.summaryCard?.destroy();pane.summaryCard=null;pane.summaryShown=false;pane.node.classList.remove('is-summary');}
function saveStatus(text,type=''){const node=$('#save-state');node.textContent=text;node.className=`save-state ${type}`;}
const questionCacheKey=(pane,qid)=>`${pane.key}:${qid}`;
async function loadQuestion(pane,qid,{fresh=false}={}){
  const key=questionCacheKey(pane,qid);if(fresh)questionsCache.delete(key);
  let cacheHit=false;
  const payload=await questionsCache.load(key,async cached=>{
    if(cached?.stamp){const stamp=await request(`${questionPath(pane.kind,pane.id,qid)}/stamp`);if(sameQuestionStamp(stamp,cached.stamp)){cacheHit=true;return cached;}}
    return request(questionPath(pane.kind,pane.id,qid));
  },{revalidate:true});
  pane.node.dataset.questionSource=cacheHit?'cache':'server';return payload;
}

function makeWriteQueue(pane){return createWriteQueue({
    makeRequestId,revisionFor:qid=>stateFor(pane,qid).revision,
    send:(qid,body)=>{if(pane.closed)throw new Error('标签页已关闭');return request(`${questionPath(pane.kind,pane.id,qid)}/actions`,{method:'POST',body:JSON.stringify(body)});},
    onBusy:busy=>{pendingWrites+=busy?1:-1;if(busy&&active()===pane)saveStatus('保存中…','saving');},
    onSaved:(qid,action,value)=>{
      questionsCache.set(questionCacheKey(pane,qid),value);
      pane.collection.states[qid]=value.state;
      if(pane.questionId===qid){pane.payload=value;if(action!=='whiteboard'&&action!=='draft')pane.plugin?.update(contextFor(pane));}
      if(active()===pane){renderOutline();updateChrome();saveStatus(pane.writes.hasFailures?'仍有内容未保存':'已保存',pane.writes.hasFailures?'error':'');renderRecovery();}
    },
    onFailed:async(qid,_action,error)=>{
      if(error.status===409){try{const latest=await loadQuestion(pane,qid,{fresh:true});pane.collection.states[qid]=latest.state;if(pane.questionId===qid)pane.payload=latest;if(active()===pane)renderOutline();}catch{/* Keep the failed input locally until a confirmed retry. */}}
      if(active()===pane){saveStatus('保存失败','error');failure(error);renderRecovery();}
    }
  });}
async function mutate(pane,action,data){
  if(action==='submit'){pane.whiteboard.flush();await saveInk(pane);}
  const value=await pane.writes.enqueue(pane.questionId,action,data,{contentVersion:pane.renderedContentVersion});
  return {ok:true,data:{status:value.state.status,result:value.state.result}};
}
function renderRecovery(){
  const pane=active(),failed=pane?.writes.failures||[];
  $('#save-recovery').hidden=!failed.length;
  $('#recovery-message').textContent=failed.some(value=>value.error.code==='CONTENT_CONFLICT')?'题目内容已更改，当前输入仍保留。请读取服务器状态后重新作答。':failed.some(value=>value.error.status===409)?'保存状态发生冲突。当前输入仍保留，可重试，或读取服务器已保存的内容。':'仍有内容未保存，切题已暂停。当前输入保留在此标签中。';
}
function enqueueInk(pane,value){
  if(pane.loading||pane.closed||!pane.questionId||pane.view!=='practice')return;
  resizeStage(pane,value.viewport);
  pane.ink.replace(value);
  clearTimeout(pane.inkTimer);
  pane.inkTimer=setTimeout(()=>{pane.inkTimer=null;saveInk(pane).catch(()=>{});},250);
}
async function saveInk(pane){
  clearTimeout(pane.inkTimer);pane.inkTimer=null;
  const snapshot=pane.ink.take();if(!snapshot)return;
  try{await mutate(pane,'whiteboard',{draft:snapshot.value});}
  catch(error){pane.ink.restore(snapshot);throw error;}
}
async function flushPane(pane){
  if(!pane||pane.closed)return;
  pane.node.inert=true;
  await pane.plugin?.flush();
  if(pane.view!=='practice')return;
  pane.whiteboard?.flush();await saveInk(pane);await pane.writes.settled();
  if(pane.writes.hasFailures){throw Object.assign(new Error('保存未完成，当前输入已保留。请重试保存，或读取服务器状态。'),{code:'SAVE_FAILED'});}
}
const pageRequest=createExtensionRouter({
  readResource,
  uploadResource:args=>request('/api/resources',{method:'POST',body:JSON.stringify(args)}),
  loadSdk:(id,version)=>sdkCache.load(`${id}:${version}:editor`,()=>request(`/api/sdk/${encodeURIComponent(id)}/${encodeURIComponent(version)}/editor`)),
  save:mutate,
  navigate:(pane,id)=>transitionTo(()=>navigateQuestion(pane,id)),
  summary:pane=>transitionTo(()=>showScoreSummary(pane)),
  ai:requestAi,
});
function requestAi(pane,method,args){
    const qid=pane.questionId;
    const client=createAiClient({request,path:questionPath(pane.kind,pane.id,qid),makeRequestId,confirmations:pane.aiConfirmations??=new Map(),
      shouldRefreshTask:task=>{const result=stateFor(pane,qid).result;return result?.gradingStatus==='pending'||result?.aiAssessment?.taskId!==task.taskId;},
      settled:async()=>{await pane.writes.settled();if(pane.writes.hasFailures)throw new Error('请先完成保存后再评分');},
      onConfirmed:value=>{if(value.state.revision<(pane.collection.states[qid]?.revision??0))return;questionsCache.set(questionCacheKey(pane,qid),value);pane.collection.states[qid]=value.state;
        if(!pane.closed&&pane.questionId===qid&&pane.view==='practice'){pane.payload=value;pane.plugin?.update(contextFor(pane));}
        if(active()===pane){renderOutline();updateChrome();saveStatus('已保存');}
      }});
    return client(method,args,pane.renderedContentVersion);
}
async function showQuestion(pane,qid,{payload:prepared,collection:descriptor=pane.collection}={}){
  pane.loading=true;
  const started=performance.now(),loading=el('div','question-loading','正在加载题目…');
  const loadingTimer=setTimeout(()=>{if(!pane.closed)pane.node.append(loading);},140);
  try{
    // Fetch first: a failed navigation must leave the old question and its ink coherent.
    const payload=prepared||await loadQuestion(pane,qid);
    const pkg=questionExtension(payload,descriptor,qid);
    if(!collectionHasExtension(descriptor,qid,pkg))descriptor=await request(collectionPath(pane.kind,pane.id));
    const page=extensionPageRoute(pkg,payload.stamp?.packageVersion);
    const assets=await prepareAssets(await pagesCache.load(page.key,()=>request(page.path)));
    pane.pageAssets=assets;
    disposeEditorSession(pane);
    disposeScoreSummary(pane);
    pane.collection=descriptor;pane.needsRefresh=false;pane.view='practice';pane.historyEntry=null;pane.historyView=null;pane.historyQuestion=null;pane.historyQuestionId=null;pane.editState=null;
    pane.node.classList.remove('is-edit');pane.node.classList.toggle('is-draft',pane.draftMode);
    pane.questionId=qid;pane.ink.clear();pane.payload=payload;pane.renderedContentVersion=payload.stamp?.contentVersion;pane.collection.states[qid]=payload.state;
    pane.plugin?.destroy();pane.plugin=null;pane.frameHost.replaceChildren();
    pane.viewport.scrollTop=0;pane.viewport.scrollLeft=0;
    const zoom=Math.max(.25,Math.min(1,(pane.viewport.clientWidth-24)/760));
    const draft=structuredClone(payload.draft)||{schemaVersion:1,viewport:{x:(pane.viewport.clientWidth/zoom-760)/2,y:0,zoom},strokes:[],paper:{color:'#ffffff',pattern:'plain'}};
    pane.whiteboard.load(draft);pane.tools.hidden=!pane.draftMode;pane.whiteboard.setMode(pane.draftMode?'draft':'practice');
    syncPracticeCamera(pane);
    pane.plugin=mountExtension(pane.frameHost,assets,contextFor(pane),{onLayout:(options,frame)=>setEditorLayout(pane,options,frame),onRequest:(method,args)=>pageRequest(pane,method,args),onError:message=>{if(active()===pane)notice(message);}});
    await pane.plugin.ready;
    syncPracticeCamera(pane);
    pane.viewport.scrollTop=0;if(active()===pane){renderTabs();renderOutline();updateChrome();saveStatus(pane.payload.state.status==='unanswered'?'': '已保存');}
  }finally{pane.loading=false;clearTimeout(loadingTimer);loading.remove();pane.node.dataset.loadMs=String(Math.round(performance.now()-started));}
}
function syncPracticeCamera(pane){
  if(pane.closed||pane.richtextFrame||!pane.whiteboard||pane.viewport.clientWidth<100)return;
  const fluid=phoneLayout.matches&&!(pane.view==='practice'&&pane.draftMode);
  if(pane.view!=='edit')pane.whiteboard.setViewCamera(fluid?{x:0,y:0,zoom:1}:practiceViewport({width:pane.viewport.clientWidth,height:pane.viewport.clientHeight,cardHeight:pane.plugin?.frame.offsetHeight||pane.frameHost.offsetHeight,horizontalGutter:112,verticalGutter:48}));
  resizeStage(pane);
}
function setEditorLayout(pane,{expanded},frame){
  if(expanded){
    if(pane.closed||active()!==pane||pane.plugin?.frame!==frame)throw new Error('当前编辑页面已切换');
    if(!pane.richtextFrame)pane.richtextScroll=pane.viewport.scrollTop;
    pane.richtextFrame=frame;pane.node.classList.add('richtext-expanded');pane.viewport.scrollTop=0;
    $('.app-shell').classList.add('richtext-workspace-open');
  }else if(pane.richtextFrame===frame){
    pane.richtextFrame=null;pane.node.classList.remove('richtext-expanded');
    $('.app-shell').classList.remove('richtext-workspace-open');
    pane.viewport.scrollTop=pane.richtextScroll||0;syncPracticeCamera(pane);
  }
}
function resizeStage(pane,camera=pane.whiteboard?.getViewCamera()){
  if(!camera)return;
  const fluid=phoneLayout.matches&&!(pane.view==='practice'&&pane.draftMode);
  const height=fluid?Math.max(pane.viewport.clientHeight,pane.world.offsetHeight):pane.view==='edit'?pane.world.offsetHeight:pane.view==='practice'&&pane.draftMode?pane.world.offsetHeight*camera.zoom+Math.max(0,camera.y*camera.zoom):Math.max(pane.viewport.clientHeight,(34+(pane.plugin?.frame.offsetHeight||pane.frameHost.offsetHeight)+camera.y)*camera.zoom+24);
  pane.stage.style.height=`${Math.max(1,height)}px`;
}
async function allowDiscardEditor(pane){
  if(pane?.view!=='edit')return true;
  pane.node.inert=true;
  const changed=await pane.editorSession.hasChanges();
  const accepted=!changed||confirm('本题库还有未保存的编辑，是否放弃所有题目的修改？');
  if(accepted){clearTimeout(pane.editorTimer);await pane.editorDraftWrites;for(const entry of pane.editorSession.values())await request(editorDraftPath(pane,entry.id),{method:'DELETE'});disposeEditorSession(pane);}
  return accepted;
}
async function navigateQuestion(pane,qid){
  if(pane.view==='edit'){await showEditorQuestion(pane,qid);return;}
  if(pane.view==='history'){await showHistoryQuestion(pane,qid);return;}
  if(!await allowDiscardEditor(pane))return;
  await flushPane(pane);await showQuestion(pane,qid);
}
async function returnToPractice(pane){
  if(!await allowDiscardEditor(pane))return;
  await flushPane(pane);const collection=await request(collectionPath(pane.kind,pane.id));
  const qid=collection.questions.some(row=>row.id===pane.questionId)?pane.questionId:collection.questions[0]?.id;
  if(!qid)throw new Error('题库中没有题目');await showQuestion(pane,qid,{collection});
}
async function showScoreSummary(pane){
  if(!hasScoreSummary(pane))return;const history=pane.view==='history';
  await flushPane(pane);pane.loading=true;updateChrome();
  try{
    const summary=history?pane.historyEntry.summary:await request(`${collectionPath(pane.kind,pane.id)}/summary`);
    disposeEditorSession(pane);disposeScoreSummary(pane);pane.plugin?.destroy();pane.plugin=null;pane.frameHost.replaceChildren();
    pane.view=history?'history':'summary';pane.summaryShown=true;pane.scoreSummary=summary;
    pane.node.classList.remove('is-edit','is-draft');pane.node.classList.add('is-summary');pane.tools.hidden=true;
    pane.whiteboard.load(null);pane.whiteboard.setMode('practice');pane.viewport.scrollTop=0;pane.viewport.scrollLeft=0;
    pane.summaryCard=mountPracticeSummary(pane.frameHost,summary,{readonly:history,onFinish:value=>finishPractice(pane,value)});
    syncPracticeCamera(pane);renderOutline();saveStatus(history?'只读汇总':summary.finished?'练习已完成':'');
  }finally{pane.loading=false;updateChrome();}
}
async function finishPractice(pane,summary){
  return transitionTo(async()=>{
    pane.loading=true;pendingWrites++;pane.node.inert=true;updateChrome();saveStatus('保存中…','saving');
    try{
      if(!pane.finishRequest||pane.finishRequest.summaryVersion!==summary.summaryVersion)pane.finishRequest={requestId:makeRequestId(),roundId:summary.roundId,summaryVersion:summary.summaryVersion};
      const value=await request(`${collectionPath(pane.kind,pane.id)}/finish`,{method:'POST',body:JSON.stringify(pane.finishRequest)});
      questionsCache.deleteCollection(`${pane.key}:`);pane.scoreSummary=value;pane.historyRecords=[];renderOutline();saveStatus('练习已完成');return value;
    }catch(error){
      if(error.status===409){
        try{const value=await request(`${collectionPath(pane.kind,pane.id)}/summary`);pane.scoreSummary=value;pane.summaryCard.update(value);pane.finishRequest=null;error.message='练习数据已更新，已刷新分值，请再次确认完成。';}catch{/* Keep the displayed summary until the server can be read. */}
      }
      saveStatus('完成练习未保存','error');throw error;
    }finally{pane.loading=false;pendingWrites--;}
  });
}
const historyPath=pane=>`${collectionPath(pane.kind,pane.id)}/history`;
const historyTime=value=>new Date(value).toLocaleString('zh-CN',{hour12:false});
let historyDeleting=false,historyDeleteDecision=null;
function historyError(message=''){const node=$('#history-error');node.textContent=message;node.hidden=!message;}
function confirmHistoryDelete(row){
  $('#history-delete-detail').textContent=`${row.collectionTitle} · ${historyTime(row.createdAt)}`;
  $('#history-delete-dialog').showModal();
  return new Promise(resolve=>{historyDeleteDecision=resolve;});
}
function finishHistoryDelete(accepted){
  const resolve=historyDeleteDecision;historyDeleteDecision=null;
  $('#history-delete-dialog').close();resolve?.(accepted);
}
function setHistoryDeleting(busy){
  historyDeleting=busy;$('#history-list').setAttribute('aria-busy',String(busy));
  for(const button of $('#history-dialog').querySelectorAll('button'))button.disabled=busy;
}
async function removeHistoryRecord(pane,id){
  pane.historyRecords=pane.historyRecords.filter(record=>record.id!==id);renderHistoryList(pane);setHistoryDeleting(true);
  if(pane.view!=='history'||pane.historyEntry.id!==id)return;
  disposeScoreSummary(pane);
  pane.plugin?.destroy();pane.plugin=null;pane.view='history-deleted';
  pane.historyEntry=null;pane.historyView=null;pane.historyQuestion=null;pane.historyQuestionId=null;
  pane.frameHost.replaceChildren(el('p','list-empty','此历史记录已删除。可以选择其他记录或返回作答。'));
  pane.whiteboard.load(null);renderOutline();updateChrome();saveStatus('记录已删除');
  try{await returnToPractice(pane);}catch(error){historyError(`记录已删除，但返回作答失败：${error.message}`);}
}
function renderHistoryList(pane){
  const list=$('#history-list');list.replaceChildren();$('#history-title').textContent=`${pane.collection.title} · 历史记录`;
  for(const row of pane.historyRecords){
    const item=el('div','history-list-item'),button=el('button','history-row'),body=el('span','history-row-body'),remove=el('button','history-delete');
    item.dataset.historyId=row.id;button.type='button';remove.type='button';
    body.append(el('strong','',row.collectionTitle),el('small','',`${historyTime(row.updatedAt||row.createdAt)} · ${historyProgress(row)}`));
    button.append(body,el('span','history-score',`${row.summary?.score??row.score} / ${row.summary?.maxScore??row.maxScore}`));
    remove.title='删除记录';remove.setAttribute('aria-label',`删除 ${historyTime(row.createdAt)} 的历史记录`);
    remove.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M9 6V4h6v2M5 6l1 14h12l1-14M10 10v6M14 10v6"/></svg>';
    button.addEventListener('click',()=>{if(historyDeleting)return;$('#history-dialog').close();transitionTo(()=>showHistory(pane,row.id));});
    remove.addEventListener('click',async()=>{
      if(historyDeleting)return;
      historyError();setHistoryDeleting(true);
      try{
        if(!await confirmHistoryDelete(row))return;
        await transitionTo(async()=>{
          try{await request(`${historyPath(pane)}/${encodeURIComponent(row.id)}`,{method:'DELETE'});}
          catch(error){if(error.status!==404)throw error;}
          await removeHistoryRecord(pane,row.id);
        });
      }catch(error){historyError(error.code==='REQUEST_TIMEOUT'?'连接超时，请重新打开历史列表确认是否已删除。':`删除失败：${error.message}`);}
      finally{setHistoryDeleting(false);($('#history-list').querySelector('.history-delete, .history-row')||$('#history-close')).focus();}
    });
    item.append(button,remove);list.append(item);
  }
  if(!pane.historyRecords.length)list.append(el('p','list-empty','还没有历史记录。首次提交后，会在这里保存本轮题库作答。'));
}
async function openHistoryList(pane){
  if(!pane)return;await flushPane(pane);
  const value=await request(historyPath(pane));pane.historyRecords=value.records;
  historyError();renderHistoryList(pane);
  if(pane.view==='history'&&!value.records.some(row=>row.id===pane.historyEntry.id))await removeHistoryRecord(pane,pane.historyEntry.id);
  setHistoryDeleting(false);
  $('#history-dialog').showModal();
}
async function showHistory(pane,id){
  if(!await allowDiscardEditor(pane))return;await flushPane(pane);
  const entry=await request(`${historyPath(pane)}/${encodeURIComponent(id)}`);
  const historyView=createHistoryView(entry),qid=historyView.questions[0].id;
  disposeEditorSession(pane);
  disposeScoreSummary(pane);
  pane.view='history';pane.historyEntry=entry;pane.historyView=historyView;pane.editState=null;
  await showHistoryQuestion(pane,qid);
}
async function showHistoryQuestion(pane,qid){
  const entry=pane.historyView.entry(qid);
  pane.loading=true;
  try{
    const assets=await prepareAssets(entry.page);
    disposeScoreSummary(pane);
    pane.plugin?.destroy();pane.plugin=null;pane.frameHost.replaceChildren();pane.historyQuestion=entry;pane.historyQuestionId=qid;
    pane.node.classList.remove('is-edit','is-draft');pane.tools.hidden=true;pane.viewport.scrollTop=0;pane.viewport.scrollLeft=0;
    pane.whiteboard.load(entry.payload.draft);pane.whiteboard.setMode('practice');
    pane.historyQuestion.page=assets;
    pane.plugin=mountExtension(pane.frameHost,assets,contextFor(pane),{onLayout:(options,frame)=>setEditorLayout(pane,options,frame),onRequest:(method,args)=>pageRequest(pane,method,args),onError:message=>{if(active()===pane)notice(message);}});
    await pane.plugin.ready;syncPracticeCamera(pane);saveStatus('只读快照');renderOutline();
  }finally{pane.loading=false;updateChrome();}
}
function disposeEditorSession(pane){
  clearTimeout(pane.editorTimer);
  if(!pane.editorSession)return;
  pane.editorSession.destroy();pane.editorSession=null;pane.editState=null;pane.plugin=null;
}
function writeEditorDraft(pane,id,entry,snapshot){const body=JSON.stringify({contentVersion:entry.value.draftVersion||entry.value.contentVersion,draft:snapshot.draft,changed:snapshot.changed});const task=(pane.editorDraftWrites||Promise.resolve()).catch(()=>{}).then(()=>request(editorDraftPath(pane,id),{method:'PUT',body}));pane.editorDraftWrites=task;return task;}
function newEditorSession(pane){return createEditorSession({ensureActive:id=>showEditorQuestion(pane,id),persistDraft:(id,entry,snapshot)=>writeEditorDraft(pane,id,entry,snapshot)});}
async function persistEditorDraft(pane){
  clearTimeout(pane.editorTimer);pane.editorTimer=null;
  const qid=pane.questionId,entry=pane.editorSession?.get(qid);if(!entry?.plugin||pane.closed)return;
  const snapshot=await entry.plugin.exportDraft();if(!snapshot.supported)return;
  await writeEditorDraft(pane,qid,entry,snapshot);entry.changed=snapshot.changed;
}
function scheduleEditorDraft(pane){clearTimeout(pane.editorTimer);pane.editorTimer=setTimeout(()=>{persistEditorDraft(pane).catch(error=>{saveStatus('编辑草稿未保存','error');failure(error);});},600);}
async function showEditorQuestion(pane,qid){
  if(!pane||pane.kind!=='bank'||pane.closed)return;
  if(pane.view==='edit'&&pane.questionId===qid&&pane.plugin)return;
  pane.node.inert=true;await pane.plugin?.flush();
  const oldPlugin=pane.plugin,session=pane.editorSession||newEditorSession(pane),old=session.get(pane.questionId);
  if(old)old.scrollTop=pane.viewport.scrollTop;
  let entry=session.get(qid);
  pane.loading=true;updateChrome();
  try{
    if(!entry?.plugin){
      await pane.editorDraftWrites;
      const value=await request(`${questionPath(pane.kind,pane.id,qid)}/editor`),savedDraft=await request(editorDraftPath(pane,qid));
      if(!value.editor)throw new Error('这个题型拓展尚未提供编辑器');
      if(savedDraft.draft!=null&&savedDraft.contentVersion!==(value.draftVersion||value.contentVersion))throw new Error('题目已变更，旧编辑草稿仍保留，请先处理版本冲突。');
      value.editor=await prepareAssets(value.editor);
      if(old?.plugin){await session.suspend(pane.questionId);pane.plugin=null;}else if(oldPlugin){oldPlugin.destroy();pane.plugin=null;}
      if(!entry)entry=session.add(qid,{id:qid,value,plugin:null,container:null,scrollTop:0});else entry.value=value;
      pane.editState=value;pane.editorSession=session;pane.view='edit';pane.questionId=qid;
      const container=el('div','editor-question-container');container.hidden=true;pane.frameHost.append(container);
      const plugin=mountExtension(container,value.editor,{mode:'edit',question:value.question,capabilities:{canEdit:true}},{editorDraft:savedDraft.draft,onDirty:()=>scheduleEditorDraft(pane),onLayout:(options,frame)=>setEditorLayout(pane,options,frame),onRequest:(method,args)=>pageRequest(pane,method,args),onError:message=>{if(active()===pane)notice(message);}});
      try{await plugin.ready;}catch(error){plugin.destroy();container.remove();throw error;}
      entry.plugin=plugin;entry.container=container;entry.changed=!!savedDraft.changed;
    }
    // Invalid intermediate forms are persisted before the previous iframe
    // is released; only the target editor remains mounted.
    pane.editorSession=session;pane.view='edit';pane.questionId=qid;pane.editState=entry.value;pane.historyEntry=null;pane.historyView=null;pane.historyQuestion=null;pane.historyQuestionId=null;pane.plugin=entry.plugin;
    entry.container.hidden=false;pane.node.classList.remove('is-draft');pane.node.classList.add('is-edit');pane.tools.hidden=true;
    pane.whiteboard.setMode('practice');pane.viewport.scrollTop=entry.scrollTop;pane.viewport.scrollLeft=0;
    syncPracticeCamera(pane);saveStatus('编辑中');renderOutline();
  }finally{pane.loading=false;updateChrome();}
}
async function openEditor(pane){
  if(!pane||pane.kind!=='bank'||pane.view!=='practice')return;await flushPane(pane);
  await showEditorQuestion(pane,pane.questionId);
}
async function saveEditor(pane){
  if(!pane||pane.view!=='edit'||pane.loading)return;
  pane.node.inert=true;await pane.plugin.flush();
  const session=pane.editorSession;let confirmed=0;pane.loading=true;pendingWrites++;updateChrome();saveStatus('保存中…','saving');
  try{
    const saved=await session.saveAll(async({id,entry,document})=>{
      const edit=entry.value;
      if(!edit.request||edit.request.title!==document.title||JSON.stringify(edit.request.data)!==JSON.stringify(document.data))edit.request={requestId:makeRequestId(),revision:edit.revision,contentVersion:edit.contentVersion,title:document.title,data:document.data};
      const body=JSON.stringify(edit.request),send=()=>request(`${questionPath(pane.kind,pane.id,id)}/edit`,{method:'POST',body});let value;
      try{value=await send();}catch(error){if(!(error instanceof TypeError))throw error;value=await send();}
      return value;
    },async({id,entry,document},value)=>{
      confirmed++;
      questionsCache.deleteCollection(`${pane.key}:`);questionsCache.set(questionCacheKey(pane,id),value.payload);
      pane.collection=value.collection;entry.value={...entry.value,question:{id,title:document.title,data:document.data},revision:value.payload.state.revision,contentVersion:value.payload.stamp.contentVersion};
      delete entry.value.request;
      clearTimeout(pane.editorTimer);await pane.editorDraftWrites;
      await request(editorDraftPath(pane,id),{method:'DELETE'});entry.changed=false;
      if(id!==pane.questionId)session.remove(id);
      else{entry.plugin?.update({mode:'edit',question:entry.value.question,capabilities:{canEdit:true}});await entry.plugin?.flush();}
    });
    const collection=await request(collectionPath(pane.kind,pane.id)),payload=await loadQuestion(pane,pane.questionId);
    await showQuestion(pane,pane.questionId,{payload,collection});await refreshCatalog();notice(saved?`已保存 ${saved} 道题目的修改。旧历史记录保留。`:'没有需要保存的修改。');
  }catch(error){
    // Display the form that needs attention without discarding other edits.
    if(error.questionId&&session.get(error.questionId)&&error.questionId!==pane.questionId){pane.loading=false;await showEditorQuestion(pane,error.questionId);pane.loading=true;if(error.phase==='validation')await pane.plugin.getDocument().catch(()=>{});}
    saveStatus(error.phase?'仍有修改未保存':'读取题库失败','error');
    const reason=error.status===409?'题目或练习状态已更新，当前编辑内容已保留。':error.message;
    const savedCount=error.savedCount??confirmed;
    error.message=savedCount?`已保存 ${savedCount} 道题；${error.phase?'其余修改仍保留。':'重新读取题库失败。'}${reason}`:reason;
    throw error;
  }finally{pane.loading=false;pendingWrites--;}
}
async function openCollection(kind,id){
  const key=`${kind}:${id}`;
  await flushPane(active());
  if(tabs.has(key)){await activateReady(key);return;}
  const collection=await request(collectionPath(kind,id));
  if(!collection.questions?.length)throw new Error('这个列表还没有题目');
  if(tabs.size>=8)throw new Error('最多同时打开 8 个题库标签，请先关闭不用的标签。');
  await suspendPane(active());
  collection.states ||= {};
  const node=el('section','question-pane'),tools=el('div','qf-whiteboard-tool-row'),viewport=el('div','question-viewport'),stage=el('div','question-stage'),world=el('div','question-world'),frameHost=el('div','question-frame-wrapper');
  tools.hidden=true;world.append(frameHost);stage.append(world);viewport.append(stage);node.append(tools,viewport);$('#panes').append(node);
  const pane={key,kind,id,collection,node,tools,viewport,stage,world,frameHost,questionId:null,payload:null,plugin:null,whiteboard:null,writes:null,ink:createDraftBuffer(),draftMode:false,view:'practice',historyEntry:null,historyRecords:[],historyView:null,historyQuestion:null,historyQuestionId:null,editState:null,editorSession:null,loading:true,closed:false,inkTimer:null};
  pane.writes=makeWriteQueue(pane);
  attachRuntime(pane);
  pane.sizeObserver=new ResizeObserver(()=>syncPracticeCamera(pane));pane.sizeObserver.observe(viewport);
  pane.worldObserver=new ResizeObserver(()=>syncPracticeCamera(pane));pane.worldObserver.observe(world);
  tabs.set(key,pane);activate(key);
  try{await showQuestion(pane,collection.questions[0].id);}
  catch(error){pane.frameHost.append(el('div','list-empty',error.message));throw error;}
}
function activate(key){activeKey=key;for(const pane of tabs.values())pane.node.hidden=pane.key!==key;$('#welcome').hidden=tabs.size>0;renderTabs();renderLibrary();renderOutline();updateChrome();renderRecovery();closeDrawers();const pane=active();saveStatus(pane?.writes.hasFailures?'仍有内容未保存':pane?.view==='history'?'只读快照':pane?.view==='edit'?'编辑中':pane?.payload&&pane.payload.state.status!=='unanswered'?'已保存':'',pane?.writes.hasFailures?'error':'');}
function attachRuntime(pane){if(pane.whiteboard)return;pane.whiteboard=mountWhiteboard(pane.viewport,{toolbarContainer:pane.tools,onChange:value=>enqueueInk(pane,value),onFullscreen:()=>draftFullscreen.toggle()});pane.whiteboard.setFullscreenState(draftFullscreen.getState());pane.sizeObserver?.observe(pane.viewport);pane.worldObserver?.observe(pane.world);}
async function suspendPane(pane){
  if(!pane||pane.closed||!pane.whiteboard)return;
  await flushPane(pane);clearTimeout(pane.editorTimer);
  pane.savedScrollTop=pane.viewport.scrollTop;
  if(pane.view==='edit'){await pane.editorSession.suspend(pane.questionId);pane.plugin=null;}
  else{pane.plugin?.destroy();pane.plugin=null;pane.frameHost.replaceChildren();if(pane.view==='history'){pane.pausedHistoryId=pane.historyEntry.id;pane.historyEntry={id:pane.historyEntry.id,collectionTitle:pane.historyEntry.collectionTitle};pane.historyView=null;pane.historyQuestion=null;}}
  pane.summaryCard?.destroy();pane.summaryCard=null;
  pane.whiteboard.destroy();pane.whiteboard=null;pane.tools.replaceChildren();pane.sizeObserver?.disconnect();pane.worldObserver?.disconnect();pane.payload=null;pane.collection.states={};
}
async function activateReady(key){
  if(activeKey!==key)await suspendPane(active());
  activate(key);const pane=tabs.get(key);if(!pane)return;
  attachRuntime(pane);
  await flushPane(pane);
  if(pane.view==='summary'){await showScoreSummary(pane);return;}
  if(pane.view==='edit'){await showEditorQuestion(pane,pane.questionId);return;}
  if(pane.view==='history'&&!pane.plugin){if(!pane.historyView){const entry=await request(`${historyPath(pane)}/${encodeURIComponent(pane.pausedHistoryId||pane.historyEntry.id)}`);pane.historyEntry=entry;pane.historyView=createHistoryView(entry);}if(pane.summaryShown&&pane.historyEntry.summary)await showScoreSummary(pane);else await showHistoryQuestion(pane,pane.historyQuestionId);return;}
  syncPracticeCamera(pane);if(pane.view!=='practice')return;
  let descriptor=pane.needsRefresh?await request(collectionPath(pane.kind,pane.id)):pane.collection;
  const qid=descriptor.questions.some(row=>row.id===pane.questionId)?pane.questionId:descriptor.questions[0]?.id;
  if(!qid)throw new Error('这个列表还没有题目');
  const payload=await loadQuestion(pane,qid);
  if(pane.needsRefresh||!pane.plugin||!sameQuestionStamp(payload.stamp,pane.payload?.stamp)){
    if(!pane.needsRefresh)descriptor=await request(collectionPath(pane.kind,pane.id));
    await showQuestion(pane,qid,{payload,collection:descriptor});
  }
}
async function closeTab(key){const pane=tabs.get(key);if(!await allowDiscardEditor(pane))return;await flushPane(pane);pane.closed=true;clearTimeout(pane.inkTimer);pane.sizeObserver.disconnect();pane.worldObserver.disconnect();disposeEditorSession(pane);disposeScoreSummary(pane);pane.plugin?.destroy();pane.whiteboard?.destroy();pane.node.remove();tabs.delete(key);questionsCache.deleteCollection(`${pane.key}:`);for(const prefix of unusedPagePrefixes(pane,tabs.values()))pagesCache.deleteCollection(prefix);if(activeKey===key){activeKey=null;await activateReady([...tabs.keys()].at(-1)||null);}else updateChrome();}
function renderTabs(){const root=$('#tabs');root.replaceChildren();for(const pane of tabs.values()){
  const tab=el('div','tab');tab.setAttribute('role','tab');tab.setAttribute('aria-selected',String(pane.key===activeKey));tab.tabIndex=pane.key===activeKey?0:-1;
  const name=el('span','tab-name',pane.collection.title);const close=el('button','tab-close','×');close.setAttribute('aria-label',`关闭 ${pane.collection.title}`);
  tab.append(name,close);tab.addEventListener('click',event=>{if(event.target!==close)transitionTo(async()=>{await flushPane(active());await activateReady(pane.key);});});tab.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();transitionTo(async()=>{await flushPane(active());await activateReady(pane.key);});}});
  close.addEventListener('click',event=>{event.stopPropagation();transitionTo(()=>closeTab(pane.key));});root.append(tab);
}}
function renderLibrary(){
  $('#show-banks').setAttribute('aria-selected',String(listMode==='bank'));$('#show-extensions').setAttribute('aria-selected',String(listMode==='extension'));$('#library-label').textContent=listMode==='bank'?'我的题库':'题型拓展';
  const root=$('#library-list');root.replaceChildren();const rows=listMode==='bank'?catalog.banks:catalog.extensions;
  for(const row of rows){const kind=listMode,key=`${kind}:${row.id}`,button=el('button',`library-item${key===activeKey?' active':''}`);button.dataset.itemId=row.id;
    const body=el('span','item-body');body.append(el('span','item-title',row.title||row.name));body.append(el('span',`item-meta${row.error?' item-error':''}`,row.error?(typeof row.error==='string'?row.error:row.error.message):`${row.questionCount} ${listMode==='bank'?'道题目':'道样例'}${row.version?' · v'+row.version:''}`));
    button.append(el('span','item-icon',kind==='bank'?'▤':'◇'),body);button.addEventListener('click',()=>{if(row.error){notice(typeof row.error==='string'?row.error:row.error.message);return;}transitionTo(()=>openCollection(kind,row.id));});root.append(button);
  }
  if(!rows.length)root.append(el('p','list-empty',listMode==='bank'?'目录中还没有题库。添加文件后刷新列表。':'目录中还没有拓展。添加文件后刷新列表。'));
  $('#catalog-count').textContent=`${catalog.banks.length} 本题库 · ${catalog.extensions.length} 个拓展`;
}
function renderOutline(){
  const pane=active(),root=$('#outline-list');root.replaceChildren();const rows=visibleQuestions(pane),qid=visibleQuestionId(pane);$('#outline-count').textContent=rows.length;
  const roundScores=new Map(pane?.summaryShown?(pane.scoreSummary?.questions||[]).map(question=>[question.id,question]):[]);
  let submitted=0,score=0,total=0;
  for(const group of consecutiveQuestionGroups(rows,pane?.view==='history'?pane.historyView.extension:pane?.collection.extension)){
    const section=el('section','outline-group'),matrix=el('div','outline-matrix');section.append(el('h2','outline-group-title',group.name),matrix);root.append(section);
    for(const {question:row,number}of group.items){
    const state=stateFor(pane,row.id);let status=roundScores.has(row.id)&&!roundScores.get(row.id).submitted?'unanswered':state.status;
    if(status==='submitted'){submitted++;score+=Number(state.result?.score)||0;total+=Number(state.result?.maxScore)||0;status=state.result?.gradingStatus==='pending'?'pending-review':state.result?.correct?'correct':'incorrect';}
    const button=el('button',`outline-item ${status}${row.id===qid?' active':''}`,String(number));button.dataset.questionId=row.id;button.setAttribute('aria-current',row.id===qid?'true':'false');button.setAttribute('aria-label',`第 ${number} 题：${row.title}`);button.title=`第 ${number} 题 · ${row.title}`;
    button.addEventListener('click',()=>transitionTo(async()=>{await navigateQuestion(pane,row.id);closeDrawers();}));matrix.append(button);
    }
  }
  if(hasScoreSummary(pane)){const button=el('button',`outline-score-summary${pane.summaryShown?' active':''}`,'分值汇总');button.addEventListener('click',()=>transitionTo(async()=>{await showScoreSummary(pane);closeDrawers();}));root.append(button);}
  const summary=$('#outline-summary');summary.replaceChildren();if(pane){const scoreValue=pane.view==='history'?pane.historyEntry?.summary:pane.summaryShown?pane.scoreSummary:null;summary.append(el('strong','',`${scoreValue?.submittedCount??submitted} / ${rows.length}`),el('span','',`${pane.view==='history'?'本轮历史 · ':''}已提交${scoreValue?' · 得分 '+scoreValue.score+' / '+scoreValue.maxScore:submitted?' · 得分 '+score+' / '+total:''}`));}else summary.append(el('span','','打开题库后查看题目'));
}
function updateChrome(){
  draftFullscreen.sync();
  const pane=active(),view=pane?.view,draftButton=$('#draft-toggle');draftButton.hidden=!pane?.payload||view!=='practice';draftButton.disabled=!!pane?.loading;draftButton.setAttribute('aria-pressed',String(!!pane?.draftMode));draftButton.replaceChildren(el('span','','✎'),document.createTextNode(pane?.draftMode?' 返回作答':' 草稿'));
  $('#history-open').hidden=!pane?.payload;$('#history-open').disabled=!!pane?.loading;
  $('#edit-open').hidden=!pane?.payload||pane.kind!=='bank'||view!=='practice';$('#edit-open').disabled=!!pane?.loading;
  $('#mode-bar').hidden=!pane||['practice','summary'].includes(view);
  for(const id of ['history-choose','return-practice'])$(`#${id}`).hidden=!['history','history-deleted'].includes(view);
  for(const id of ['edit-cancel','edit-save']){$(`#${id}`).hidden=view!=='edit';$(`#${id}`).disabled=!!pane?.loading;}
  $('#edit-save').textContent='保存全部修改';
  $('#mode-label').textContent=view==='history'?`只读历史 · ${historyProgress(pane.historyEntry)} · ${historyTime(pane.historyEntry.createdAt)}`:view==='history-deleted'?'记录已删除，请选择其他记录或返回作答。':view==='edit'?'编辑题库 · 切题保留未保存内容，保存后仅重置内容有改动的题目':'';
  if(!pane){$('#document-title').textContent='选择一本题库';$('#progress-text').textContent='';$('#previous').disabled=true;$('#next').disabled=true;saveStatus('');return;}
  const rows=visibleQuestions(pane),index=navigationIndex(pane),count=rows.length;
  $('#document-title').textContent=view==='history'?pane.historyEntry.collectionTitle:pane.collection.title;
  $('#progress-text').textContent=pane.summaryShown?'分值汇总':view==='history-deleted'?'历史记录已删除':index<0?'正在加载题目…':`第 ${index+1} 题 / 共 ${count} 题`;
  $('#previous').disabled=pane.loading||index<=0;$('#next').disabled=pane.loading||!count||index>=(hasScoreSummary(pane)?count:count-1);
  for(const [id,label]of [['previous',pane.summaryShown?'返回最后一题':'上一题'],['next',index===count-1&&hasScoreSummary(pane)?'查看分值汇总':'下一题']]){$(`#${id}`).title=label;$(`#${id}`).setAttribute('aria-label',label);}
}
function syncSidebars(){
  let anyDrawer=false;
  for(const key of ['library','outline']){
    const target=$(`.${key}`),drawer=(key==='library'?libraryDrawer:outlineDrawer).matches;
    const visible=drawer?target.classList.contains('open'):sidebarPreferences[key];
    target.hidden=!drawer&&!visible;target.inert=!visible;target.setAttribute('aria-hidden',String(!visible));
    $('.app-shell').classList.toggle(`${key}-hidden`,!drawer&&!visible);
    const button=$(`#${key}-toggle`),label=`${visible?'隐藏':'显示'}${key==='library'?'文件列表':'题目大纲'}`;
    button.setAttribute('aria-label',label);button.title=label;button.setAttribute('aria-expanded',String(visible));
    anyDrawer ||= drawer&&visible;
  }
  $('#scrim').hidden=!anyDrawer;
}
function closeDrawers(){$('.library').classList.remove('open');$('.outline').classList.remove('open');syncSidebars();}
function toggleSidebar(key){
  const target=$(`.${key}`),drawer=(key==='library'?libraryDrawer:outlineDrawer).matches;
  if(drawer){const wasOpen=target.classList.contains('open');closeDrawers();if(!wasOpen)target.classList.add('open');}
  else{sidebarPreferences[key]=!sidebarPreferences[key];try{localStorage.setItem('quizforge-sidebars',JSON.stringify(sidebarPreferences));}catch{}}
  syncSidebars();
}
async function refreshCatalog(){
  const button=$('#refresh');button.classList.add('is-loading');
  // A cold directory scan validates installed versions and banks in separate rule processes.
  try{const value=await request('/api/catalog',{timeoutMs:60000});catalog.banks=value.banks;catalog.extensions=value.extensions;renderLibrary();}
  catch(error){if(error.status===401){if(!$('#access-dialog').open)$('#access-dialog').showModal();}else throw error;}
  finally{button.classList.remove('is-loading');}
}
function switchList(kind){listMode=kind;renderLibrary();const open=[...tabs.values()].filter(pane=>pane.kind===kind).at(-1);const first=(kind==='bank'?catalog.banks:catalog.extensions).find(row=>!row.error);if(open||first)transitionTo(()=>openCollection(kind,open?.id||first.id));}
$('#show-banks').addEventListener('click',()=>switchList('bank'));$('#show-extensions').addEventListener('click',()=>switchList('extension'));
$('#refresh').addEventListener('click',()=>transitionTo(async()=>{for(const pane of tabs.values())await flushPane(pane);questionsCache.clear();pagesCache.clear();await refreshCatalog();for(const pane of tabs.values())pane.needsRefresh=true;if(activeKey)await activateReady(activeKey);}));
$('#retry-save').addEventListener('click',()=>transitionTo(async()=>{const pane=active();if(!pane)return;pane.node.inert=true;await pane.plugin?.flush();pane.whiteboard.flush();await pane.writes.settled();await saveInk(pane);for(const value of pane.writes.failures){await pane.writes.enqueue(value.questionId,value.action,value.data,{contentVersion:value.contentVersion});}if(!pane.writes.hasFailures)notice('');}));
$('#load-saved').addEventListener('click',()=>{const pane=active();if(!pane||!confirm('读取服务器状态会放弃当前未保存的答案和笔迹，是否继续？'))return;transitionTo(async()=>{pane.node.inert=true;await pane.plugin?.flush();await pane.writes.settled();const payload=await loadQuestion(pane,pane.questionId,{fresh:true});clearTimeout(pane.inkTimer);pane.inkTimer=null;pane.ink.clear();pane.writes.clear();await showQuestion(pane,pane.questionId,{payload});notice('已读取服务器保存的状态。');});});
$('#draft-toggle').addEventListener('click',()=>transitionTo(async()=>{const pane=active();if(!pane?.payload||pane.view!=='practice')return;await flushPane(pane);pane.draftMode=!pane.draftMode;pane.node.classList.toggle('is-draft',pane.draftMode);pane.tools.hidden=!pane.draftMode;pane.viewport.scrollTop=0;pane.viewport.scrollLeft=0;pane.whiteboard.setMode(pane.draftMode?'draft':'practice');syncPracticeCamera(pane);updateChrome();}));
for(const [id,offset]of [['previous',-1],['next',1]])$(`#${id}`).addEventListener('click',()=>transitionTo(async()=>{const pane=active();if(!pane)return;const rows=visibleQuestions(pane),index=navigationIndex(pane),target=rows[index+offset];if(target)await navigateQuestion(pane,target.id);else if(index+offset===rows.length&&hasScoreSummary(pane))await showScoreSummary(pane);}));
for(const id of ['history-open','history-choose'])$(`#${id}`).addEventListener('click',()=>transitionTo(()=>openHistoryList(active())));
$('#history-close').addEventListener('click',()=>$('#history-dialog').close());
$('#history-dialog').addEventListener('cancel',event=>{if(historyDeleting)event.preventDefault();});
$('#history-delete-cancel').addEventListener('click',()=>finishHistoryDelete(false));
$('#history-delete-confirm').addEventListener('click',()=>finishHistoryDelete(true));
$('#history-delete-dialog').addEventListener('cancel',event=>{event.preventDefault();finishHistoryDelete(false);});
$('#history-delete-dialog').addEventListener('close',()=>{const resolve=historyDeleteDecision;historyDeleteDecision=null;resolve?.(false);});
$('#return-practice').addEventListener('click',()=>transitionTo(()=>returnToPractice(active())));
$('#edit-open').addEventListener('click',()=>transitionTo(()=>openEditor(active())));
$('#edit-save').addEventListener('click',()=>transitionTo(()=>saveEditor(active())));
$('#edit-cancel').addEventListener('click',()=>transitionTo(()=>returnToPractice(active())));
for(const key of ['library','outline']){for(const suffix of ['toggle','hide'])$(`#${key}-${suffix}`).addEventListener('click',()=>toggleSidebar(key));}
for(const media of [libraryDrawer,outlineDrawer])media.addEventListener('change',closeDrawers);
phoneLayout.addEventListener('change',()=>{for(const pane of tabs.values())syncPracticeCamera(pane);});
$('#scrim').addEventListener('click',closeDrawers);syncSidebars();
bindAiSettings({request});
bindNetworkSettings({request,beforeSave:()=>transitionTo(async()=>{for(const pane of tabs.values())await flushPane(pane);})});
document.addEventListener('quizforge-auth-required',()=>{const dialog=$('#access-dialog');if(!dialog.open)dialog.showModal();});
$('#access-form').addEventListener('submit',async event=>{
  event.preventDefault();const button=event.currentTarget.querySelector('button[type="submit"]');if(button.disabled)return;
  button.disabled=true;$('#access-error').textContent='';
  try{const value=await request('/api/auth/login',{method:'POST',body:JSON.stringify({password:$('#access-token').value})});setAccessToken(value.token);$('#access-token').value='';$('#access-dialog').close();await start();}
  catch(error){$('#access-error').textContent=error.code==='PASSWORD_REQUIRED'||error.code==='TOKEN_REQUIRED'?'密码不正确，请重试。':error.code==='LOGIN_RATE_LIMITED'?'尝试次数过多，请等待一分钟后再连接。':error.message;}
  finally{button.disabled=false;}
});
window.addEventListener('beforeunload',event=>{if(pendingWrites||[...tabs.values()].some(pane=>pane.ink.pending||pane.writes.hasFailures||pane.editorSession?.isDirty)){event.preventDefault();event.returnValue='';}});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'){const pane=active();if(pane&&!pane.loading&&pane.view==='practice'){pane.whiteboard.flush();saveInk(pane).catch(()=>{});}}});
async function start(){await refreshCatalog();const first=catalog.banks.find(row=>!row.error);if(first&&!tabs.size)await transitionTo(()=>openCollection('bank',first.id));}
start().catch(failure);
