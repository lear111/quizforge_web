import {request,readResource,setAccessToken,collectionPath,questionPath,makeRequestId} from './api.js';
import {mountExtension} from './frame.js';
import {prepareExtensionAssets} from './page-assets.js';
import {mountWhiteboard} from './whiteboard.js';
import {createWriteQueue,createDraftBuffer} from './write-queue.js';
import {createQuestionCache} from './question-cache.js';
import {consecutiveQuestionGroups} from './outline-groups.js';
import {navigateOutlineTarget} from './outline-navigation.js';
import {practiceViewport} from './view-camera.js';
import {createHistoryView,historyProgress} from './history-view.js';
import {createEditorSession} from './editor-session.js';
import {mountPracticeSummary} from './practice-summary.js';
import {bindNetworkSettings} from './network-settings.js';
import {bindAiSettings} from './ai-settings.js';
import {bindDevelopmentSettings} from './development-settings.js';
import {createDevelopmentWatcher} from './development-watch.js';
import {createAiClient} from './ai-client.js';
import {createDraftFullscreen} from './draft-fullscreen.js';
import {visibleQuestions,visibleQuestionId,hasScoreSummary,navigationIndex,stateFor,contextFor,collectionFeature,canEditCollection,practiceSaveLabel,canViewDraft,draftViewActive} from './practice-context.js';
import {createExtensionRouter} from './extension-requests.js';
import {questionExtension,collectionHasExtension,extensionPageRoute,sameQuestionStamp,unusedPagePrefixes} from './extension-pages.js';
import {extensionGroups} from './extension-groups.js';

const $=selector=>document.querySelector(selector);
const catalog={banks:[],extensions:[],developmentEnabled:false},collections=new Map();
const collapsedExtensionGroups=new Set();
const questionsCache=createQuestionCache(),pagesCache=createQuestionCache({capacity:4,maxBytes:4*1024*1024});
const sdkCache=createQuestionCache({capacity:4,maxBytes:8*1024*1024});
const editorDraftPath=(pane,qid)=>`/api/${pane.kind.startsWith('development')?'development/':''}editor-drafts/${encodeURIComponent(pane.id)}/${encodeURIComponent(qid)}${['extension','development'].includes(pane.kind)?`?kind=${pane.kind}`:''}`;
async function prepareAssets(assets){return prepareExtensionAssets(assets,dependency=>sdkCache.load(`${dependency.id}:${dependency.version}:static`,()=>request(`/api/sdk/${encodeURIComponent(dependency.id)}/${encodeURIComponent(dependency.version)}`)));}
const sidebarPreferences={library:true,outline:true};
try{const saved=JSON.parse(localStorage.getItem('quizforge-sidebars')||'{}');for(const key of Object.keys(sidebarPreferences))if(typeof saved[key]==='boolean')sidebarPreferences[key]=saved[key];}catch{}
const libraryDrawer=matchMedia('(max-width:800px)'),outlineDrawer=matchMedia('(max-width:1100px)');
const phoneLayout=matchMedia('(max-width:600px)');
let listMode='bank',activeKey=null,transition=Promise.resolve(),pendingWrites=0;
const el=(tag,className,text)=>{const node=document.createElement(tag);if(className)node.className=className;if(text!=null)node.textContent=text;return node;};
function notice(message){$('#notice').textContent=message||'';$('#notice').hidden=!message;}
function failure(error){notice(error.message||String(error));}
function transitionTo(fn){const run=transition.then(async()=>{notice('');$('#previous').disabled=true;$('#next').disabled=true;try{return await fn();}finally{for(const pane of collections.values())pane.node.inert=false;updateChrome();renderRecovery();}});transition=run.catch(()=>{});run.catch(failure);return run;}
const active=()=>collections.get(activeKey);
const draftFullscreen=createDraftFullscreen(document,{
  canEnter:()=>draftViewActive(active()),
  onChange:state=>{const shell=$('.app-shell');if(state.active&&!shell.classList.contains('draft-fullscreen'))closeDrawers();shell.classList.toggle('draft-fullscreen',state.active);for(const pane of collections.values())pane.whiteboard?.setFullscreenState(state);},
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
    send:(qid,body)=>{if(pane.closed)throw new Error('题库页面已关闭');return request(`${questionPath(pane.kind,pane.id,qid)}/actions`,{method:'POST',body:JSON.stringify(body)});},
    onBusy:busy=>{pendingWrites+=busy?1:-1;if(busy&&active()===pane)saveStatus(collectionFeature(pane,'history')?'保存中…':'当前会话','saving');},
    onSaved:(qid,action,value)=>{
      questionsCache.set(questionCacheKey(pane,qid),value);
      pane.collection.states[qid]=value.state;
      if(pane.questionId===qid){pane.payload=value;if(action!=='whiteboard'&&action!=='draft')pane.plugin?.update(contextFor(pane));}
      if(active()===pane){renderOutline();updateChrome();saveStatus(pane.writes.hasFailures?'仍有内容未保存':practiceSaveLabel(pane),pane.writes.hasFailures?'error':'');renderRecovery();}
    },
    onFailed:async(qid,_action,error)=>{
      if(error.status===409){try{const latest=await loadQuestion(pane,qid,{fresh:true});pane.collection.states[qid]=latest.state;if(pane.questionId===qid)pane.payload=latest;if(active()===pane)renderOutline();}catch{/* Keep the failed input locally until a confirmed retry. */}}
      if(active()===pane){saveStatus('保存失败','error');failure(error);renderRecovery();}
    }
  });}
async function mutate(pane,action,data){
  if(action==='whiteboard'&&!collectionFeature(pane,'whiteboard'))throw Object.assign(new Error('题库未开放草稿白板'),{code:'FEATURE_DISABLED'});
  if(action==='submit'){pane.whiteboard.flush();await saveInk(pane);}
  const value=await pane.writes.enqueue(pane.questionId,action,data,{contentVersion:pane.renderedContentVersion});
  return {ok:true,data:{status:value.state.status,result:value.state.result}};
}
function renderRecovery(){
  const pane=active(),failed=pane?.writes.failures||[];
  $('#save-recovery').hidden=!failed.length;
  $('#recovery-message').textContent=failed.some(value=>value.error.code==='CONTENT_CONFLICT')?'题目内容已更改，当前输入仍保留。请读取服务器状态后重新作答。':failed.some(value=>value.error.status===409)?'保存状态发生冲突。当前输入仍保留，可重试，或读取服务器已保存的内容。':pane?.development?'仍有内容未保存，当前输入保留。可以切题后返回重试。':'仍有内容未保存，切题已暂停。当前输入仍保留。';
}
function enqueueInk(pane,value){
  if(pane.loading||pane.closed||!pane.questionId||pane.view!=='practice'||!collectionFeature(pane,'whiteboard'))return;
  resizeStage(pane,value.viewport);
  pane.ink.replace(value);
  clearTimeout(pane.inkTimer);
  pane.inkTimer=setTimeout(()=>{pane.inkTimer=null;saveInk(pane).catch(()=>{});},250);
}
async function saveInk(pane){
  clearTimeout(pane.inkTimer);pane.inkTimer=null;
  if(!collectionFeature(pane,'whiteboard')){pane.ink.clear();return;}
  const snapshot=pane.ink.take();if(!snapshot)return;
  try{await mutate(pane,'whiteboard',{draft:snapshot.value});}
  catch(error){pane.ink.restore(snapshot);throw error;}
}
async function flushPane(pane){
  if(!pane||pane.closed)return;
  pane.node.inert=true;
  try{
    if(!pane.development||!pane.plugin?.hasError)await pane.plugin?.flush();
    if(pane.view!=='practice')return true;
    pane.whiteboard?.flush();await saveInk(pane);await pane.writes.settled();
    if(pane.writes.hasFailures)throw Object.assign(new Error('保存未完成，当前输入已保留。请重试保存，或读取服务器状态。'),{code:'SAVE_FAILED'});
    return !pane.plugin?.hasUnsavedInput;
  }catch(error){
    if(!pane.development)throw error;
    pane.keepRuntime=true;if(active()===pane){saveStatus('开发功能尚未完成，当前输入保留','error');notice(error.message);}
    return false;
  }
}
const pageRequest=createExtensionRouter({
  readResource:(id,pane)=>readResource(id,{development:pane.kind.startsWith('development')}),
  uploadResource:(args,pane)=>request(`/api/${pane.kind.startsWith('development')?'development/':''}resources`,{method:'POST',headers:pane.view==='practice'&&!collectionFeature(pane,'history')?{'X-QuizForge-Transient-Resource':'true'}:{},body:JSON.stringify(args)}),
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
        if(active()===pane){renderOutline();updateChrome();saveStatus(practiceSaveLabel(pane));}
      }});
    return client(method,args,pane.renderedContentVersion);
}
async function showQuestion(pane,qid,{payload:prepared,collection:descriptor=pane.collection,preserveFrame=true,canCommit=()=>true}={}){
  pane.loading=true;
  let candidateHost=null,candidatePlugin=null;
  const started=performance.now(),loading=el('div','question-loading','正在加载题目…');
  const loadingTimer=setTimeout(()=>{if(!pane.closed)pane.node.append(loading);},140);
  try{
    // Fetch first: a failed navigation must leave the old question and its ink coherent.
    const payload=prepared||await loadQuestion(pane,qid);
    const pkg=questionExtension(payload,descriptor,qid);
    if(!collectionHasExtension(descriptor,qid,pkg))descriptor=await request(collectionPath(pane.kind,pane.id));
    const page=extensionPageRoute(pkg,payload.stamp?.packageVersion);
    const assets=await prepareAssets(await pagesCache.load(page.key,()=>request(page.path)));
    {
      candidateHost=el('div','development-preview-candidate');pane.frameHost.append(candidateHost);
      candidatePlugin=mountExtension(candidateHost,assets,contextFor({...pane,collection:descriptor,questionId:qid,payload,view:'practice'}),{onLayout:(options,frame)=>setEditorLayout(pane,options,frame),onRequest:(method,args)=>pane.plugin===candidatePlugin&&pane.questionId===qid?pageRequest(pane,method,args):['resource-get','sdk-editor'].includes(method)?pageRequest({...pane,view:'development-loading',pageAssets:assets},method,args):Promise.resolve({ok:false,error:{code:'READ_ONLY',message:'当前题卡未处于活动状态'}}),onError:message=>{if(!pane.closed&&pane.plugin===candidatePlugin)showPageFailure(pane,new Error(message));}});
      await candidatePlugin.ready;
      if(pane.closed||!canCommit())throw new Error('开发预览已切换');
    }
    pane.pageAssets=assets;
    disposeEditorSession(pane);
    disposeScoreSummary(pane);
    pane.collection=descriptor;pane.needsRefresh=false;pane.view='practice';pane.historyEntry=null;pane.historyView=null;pane.historyQuestion=null;pane.historyQuestionId=null;pane.editState=null;
    if(!collectionFeature(pane,'whiteboard'))pane.draftMode=false;
    pane.node.classList.remove('is-edit');pane.node.classList.toggle('is-draft',pane.draftMode);
    pane.questionId=qid;pane.outlineItemId=null;pane.ink.clear();pane.payload=payload;pane.renderedContentVersion=payload.stamp?.contentVersion;pane.collection.states[qid]=payload.state;
    pane.plugin?.destroy();pane.plugin=null;if(candidateHost){for(const child of [...pane.frameHost.children])if(child!==candidateHost&&!child.classList.contains('development-retained-question'))child.remove();candidateHost.classList.remove('development-preview-candidate');}else pane.frameHost.replaceChildren();
    pane.viewport.scrollTop=0;pane.viewport.scrollLeft=0;
    const zoom=Math.max(.25,Math.min(1,(pane.viewport.clientWidth-24)/760));
    const draft=collectionFeature(pane,'whiteboard')&&structuredClone(payload.draft)||{schemaVersion:1,viewport:{x:(pane.viewport.clientWidth/zoom-760)/2,y:0,zoom},strokes:[],paper:{color:'#ffffff',pattern:'plain'}};
    pane.whiteboard.setReadOnly(false);pane.whiteboard.load(draft);pane.tools.hidden=!pane.draftMode;pane.whiteboard.setMode(pane.draftMode?'draft':'practice');
    syncPracticeCamera(pane);
    pane.plugin=candidatePlugin;
    await pane.plugin.ready;
    pane.keepRuntime=false;clearPageFailure(pane);
    syncPracticeCamera(pane);
    pane.viewport.scrollTop=0;if(active()===pane){renderOutline();updateChrome();saveStatus(pane.payload.state.status==='unanswered'?'':practiceSaveLabel(pane));}
    if(pane.restartApplied){pane.scoreSummary=null;pane.restartRequest=null;pane.restartApplied=false;}
  }catch(error){if(candidatePlugin&&pane.plugin!==candidatePlugin){candidatePlugin.destroy();candidateHost?.remove();}if(!pane.plugin&&!pane.questionId)pane.questionId=qid;showPageFailure(pane,error,qid);throw error;}
  finally{pane.loading=false;clearTimeout(loadingTimer);loading.remove();pane.node.dataset.loadMs=String(Math.round(performance.now()-started));}
}
function clearPageFailure(pane){pane.errorBox?.remove();pane.errorBox=null;pane.pageFailure=null;}
function showPageFailure(pane,error,qid=pane.questionId){
  if(pane.closed)return;clearPageFailure(pane);pane.pageFailure={error,qid};
  const box=el('div','question-error'),message=el('p','',String(error.message||error).slice(0,1000)),retry=el('button','','重新加载题卡');
  box.setAttribute('role','alert');retry.type='button';retry.addEventListener('click',()=>transitionTo(async()=>{
    if(pane.closed)return;
    if((pane.plugin?.hasUnsavedInput||pane.keepRuntime)&&!confirm('重新加载会放弃这张题卡尚未保存的输入，是否继续？'))return;
    pagesCache.clear();questionsCache.delete(questionCacheKey(pane,qid));
    if(pane.view==='edit'){pane.editorSession?.remove(qid);pane.plugin=null;await showEditorQuestion(pane,qid);clearPageFailure(pane);}
    else if(pane.view==='history'){await showHistoryQuestion(pane,qid);clearPageFailure(pane);}
    else await showQuestion(pane,qid,{payload:await loadQuestion(pane,qid,{fresh:true})});
  }));
  box.append(el('strong','','当前题卡未能完成操作'),message,retry);pane.node.prepend(box);pane.errorBox=box;
}
function parkDevelopmentQuestion(pane){
  if(!pane.plugin)return;
  const retained=pane.retainedQuestions??=new Map();
  if(retained.size>=4&&!retained.has(pane.questionId))throw new Error('已有 4 张开发题卡保留未保存输入，请先重试保存或关闭标签。');
  const host=pane.plugin.frame.parentElement;pane.plugin.setActive?.(false);host.hidden=true;host.classList.add('development-retained-question');
  retained.set(pane.questionId,{plugin:pane.plugin,host,payload:pane.payload,pageAssets:pane.pageAssets,contentVersion:pane.renderedContentVersion,draft:pane.whiteboard.getDraft(),ink:pane.ink,scrollTop:pane.viewport.scrollTop,draftMode:pane.draftMode});
  pane.plugin=null;pane.ink=createDraftBuffer();pane.keepRuntime=false;clearPageFailure(pane);
}
function restoreDevelopmentQuestion(pane,qid){
  const value=pane.retainedQuestions?.get(qid);if(!value)return false;
  pane.plugin?.destroy();for(const child of [...pane.frameHost.children])if(child!==value.host&&!child.classList.contains('development-retained-question'))child.remove();
  pane.retainedQuestions.delete(qid);value.host.hidden=false;value.host.classList.remove('development-retained-question');pane.plugin=value.plugin;pane.payload=value.payload;pane.pageAssets=value.pageAssets;pane.questionId=qid;pane.renderedContentVersion=value.contentVersion;pane.ink=value.ink;pane.draftMode=value.draftMode;pane.plugin.setActive?.(true);
  pane.whiteboard.load(value.draft);pane.whiteboard.setMode(pane.draftMode?'draft':'practice');pane.tools.hidden=!pane.draftMode;pane.node.classList.toggle('is-draft',pane.draftMode);pane.viewport.scrollTop=value.scrollTop;clearPageFailure(pane);syncPracticeCamera(pane);renderOutline();updateChrome();return true;
}
function disposeRetainedQuestions(pane){for(const value of pane.retainedQuestions?.values()||[]){value.plugin.destroy();value.host.remove();}pane.retainedQuestions?.clear();}
function allowLeaveDevelopmentInput(pane){
  if(!pane.development||!(pane.plugin?.hasUnsavedInput||pane.keepRuntime||pane.retainedQuestions?.size))return true;
  if(!confirm('开发题卡仍有未保存输入，切换模式会丢弃这些输入，是否继续？'))return false;
  disposeRetainedQuestions(pane);return true;
}
async function toggleDraftMode(pane=active()){
  if(!canViewDraft(pane)||pane.loading)return;
  if(pane.view==='practice')await flushPane(pane);
  const key=pane.view==='history'?'historyDraftMode':'draftMode';
  pane[key]=!pane[key];
  const draft=draftViewActive(pane);
  pane.node.classList.toggle('is-draft',draft);pane.tools.hidden=!draft;
  pane.viewport.scrollTop=0;pane.viewport.scrollLeft=0;
  pane.whiteboard.setMode(draft?'draft':'practice');syncPracticeCamera(pane);updateChrome();
}
function syncPracticeCamera(pane){
  if(pane.closed||pane.richtextFrame||!pane.whiteboard||pane.viewport.clientWidth<100)return;
  const fluid=phoneLayout.matches&&!draftViewActive(pane);
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
  const fluid=phoneLayout.matches&&!draftViewActive(pane);
  const height=fluid?Math.max(pane.viewport.clientHeight,pane.world.offsetHeight):pane.view==='edit'?pane.world.offsetHeight:draftViewActive(pane)?pane.world.offsetHeight*camera.zoom+Math.max(0,camera.y*camera.zoom):Math.max(pane.viewport.clientHeight,(34+(pane.plugin?.frame.offsetHeight||pane.frameHost.offsetHeight)+camera.y)*camera.zoom+24);
  pane.stage.style.height=`${Math.max(1,height)}px`;
}
async function allowDiscardEditor(pane){
  if(pane?.view!=='edit')return true;
  pane.node.inert=true;
  let changed;try{changed=await pane.editorSession.hasChanges();}catch(error){if(!pane.development)throw error;changed=true;}
  const accepted=!changed||confirm('本题库还有未保存的编辑，是否放弃所有题目的修改？');
  if(accepted){clearTimeout(pane.editorTimer);await pane.editorDraftWrites;if(collectionFeature(pane,'history'))for(const entry of pane.editorSession.values())await request(editorDraftPath(pane,entry.id),{method:'DELETE'});disposeEditorSession(pane);}
  return accepted;
}
async function navigateQuestion(pane,qid){
  if(pane.view==='edit'){await showEditorQuestion(pane,qid);return;}
  if(pane.view==='history'){await showHistoryQuestion(pane,qid);return;}
  if(!await allowDiscardEditor(pane))return;
  const saved=await flushPane(pane),previousId=pane.questionId;
  if(pane.development&&saved===false)parkDevelopmentQuestion(pane);
  if(pane.development&&restoreDevelopmentQuestion(pane,qid))return;
  try{await showQuestion(pane,qid);}catch(error){if(pane.development)restoreDevelopmentQuestion(pane,previousId);throw error;}
}
async function returnToPractice(pane){
  if(!await allowDiscardEditor(pane))return;
  await flushPane(pane);const collection=await request(collectionPath(pane.kind,pane.id));
  const qid=collection.questions.some(row=>row.id===pane.questionId)?pane.questionId:collection.questions[0]?.id;
  if(!qid)throw new Error('题库中没有题目');await showQuestion(pane,qid,{collection});
}
async function showScoreSummary(pane){
  if(!hasScoreSummary(pane))return;const history=pane.view==='history';
  await flushPane(pane);if(!allowLeaveDevelopmentInput(pane))return;pane.loading=true;updateChrome();
  try{
    const summary=history?pane.historyEntry.summary:await request(`${collectionPath(pane.kind,pane.id)}/summary`);
    disposeEditorSession(pane);disposeScoreSummary(pane);pane.plugin?.destroy();pane.plugin=null;pane.frameHost.replaceChildren();
    pane.view=history?'history':'summary';pane.summaryShown=true;pane.outlineItemId=null;pane.scoreSummary=summary;
    pane.node.classList.remove('is-edit','is-draft');pane.node.classList.add('is-summary');pane.tools.hidden=true;
    pane.whiteboard.load(null);pane.whiteboard.setMode('practice');pane.viewport.scrollTop=0;pane.viewport.scrollLeft=0;
    pane.summaryCard=mountPracticeSummary(pane.frameHost,summary,{readonly:history,history:collectionFeature(pane,'history'),onFinish:value=>finishPractice(pane,value),onRestart:value=>restartPractice(pane,value)});
    syncPracticeCamera(pane);renderOutline();saveStatus(history?'只读汇总':summary.finished?(collectionFeature(pane,'history')?'练习已完成':'当前会话 · 已完成'):'');
  }finally{pane.loading=false;updateChrome();}
}
async function finishPractice(pane,summary){
  return transitionTo(async()=>{
    pane.loading=true;pendingWrites++;pane.node.inert=true;updateChrome();saveStatus(collectionFeature(pane,'history')?'保存中…':'当前会话 · 正在完成','saving');
    try{
      if(!pane.finishRequest||pane.finishRequest.summaryVersion!==summary.summaryVersion)pane.finishRequest={requestId:makeRequestId(),roundId:summary.roundId,summaryVersion:summary.summaryVersion};
      const value=await request(`${collectionPath(pane.kind,pane.id)}/finish`,{method:'POST',body:JSON.stringify(pane.finishRequest)});
      questionsCache.deleteCollection(`${pane.key}:`);pane.scoreSummary=value;pane.historyRecords=[];renderOutline();saveStatus(value.historyId?'练习已完成':'当前会话 · 已完成');return value;
    }catch(error){
      if(error.status===409){
        try{const value=await request(`${collectionPath(pane.kind,pane.id)}/summary`);pane.scoreSummary=value;pane.summaryCard.update(value);pane.finishRequest=null;error.message='练习数据已更新，已刷新分值，请再次确认完成。';}catch{/* Keep the displayed summary until the server can be read. */}
      }
      saveStatus('完成练习未保存','error');throw error;
    }finally{pane.loading=false;pendingWrites--;}
  });
}
async function restartPractice(pane,summary){
  return transitionTo(async()=>{
    if(pane.closed||pane.view!=='summary')return;
    pane.loading=true;pendingWrites++;pane.node.inert=true;updateChrome();saveStatus('正在开始新一轮…','saving');
    try{
      if(!pane.restartApplied){
        if(!pane.restartRequest||pane.restartRequest.summaryVersion!==summary.summaryVersion)pane.restartRequest={requestId:makeRequestId(),roundId:summary.roundId,summaryVersion:summary.summaryVersion};
        await request(`${collectionPath(pane.kind,pane.id)}/restart`,{method:'POST',body:JSON.stringify(pane.restartRequest)});
        pane.restartApplied=true;pane.finishRequest=null;pane.historyRecords=[];
      }
      // Retry a failed load without resetting a round that already started on the server.
      questionsCache.deleteCollection(`${pane.key}:`);pane.ink.clear();clearTimeout(pane.inkTimer);
      const collection=await request(collectionPath(pane.kind,pane.id)),first=collection.questions[0]?.id;
      if(!first)throw new Error('题库中没有题目');
      pane.draftMode=false;await showQuestion(pane,first,{collection});
      pane.scoreSummary=null;pane.restartRequest=null;pane.restartApplied=false;saveStatus('新一轮练习');
    }catch(error){
      if(!pane.restartApplied&&error.status===409){
        try{const value=await request(`${collectionPath(pane.kind,pane.id)}/summary`);pane.scoreSummary=value;pane.summaryCard?.update(value);pane.restartRequest=null;error.message='练习数据已更新，请重新确认后再开始新一轮。';}catch{/* Keep the displayed summary until the server can be read. */}
      }
      saveStatus(pane.restartApplied?'新一轮已开始，题卡加载失败':'未能开始新一轮','error');throw error;
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
  if(!pane||!collectionFeature(pane,'history'))return;await flushPane(pane);
  const value=await request(historyPath(pane));pane.historyRecords=value.records;
  historyError();renderHistoryList(pane);
  if(pane.view==='history'&&!value.records.some(row=>row.id===pane.historyEntry.id))await removeHistoryRecord(pane,pane.historyEntry.id);
  setHistoryDeleting(false);
  $('#history-dialog').showModal();
}
async function showHistory(pane,id){
  if(!collectionFeature(pane,'history'))return;
  if(!await allowDiscardEditor(pane))return;await flushPane(pane);if(!allowLeaveDevelopmentInput(pane))return;
  const entry=await request(`${historyPath(pane)}/${encodeURIComponent(id)}`);
  const historyView=createHistoryView(entry),qid=historyView.questions[0].id;
  disposeEditorSession(pane);
  disposeScoreSummary(pane);
  pane.view='history';pane.historyEntry=entry;pane.historyView=historyView;pane.historyDraftMode=false;pane.editState=null;
  await showHistoryQuestion(pane,qid);
}
async function showHistoryQuestion(pane,qid){
  const entry=pane.historyView.entry(qid);
  pane.loading=true;
  try{
    const assets=await prepareAssets(entry.page);
    disposeScoreSummary(pane);
    pane.plugin?.destroy();pane.plugin=null;pane.frameHost.replaceChildren();pane.historyQuestion=entry;pane.historyQuestionId=qid;pane.outlineItemId=null;
    const draft=draftViewActive(pane);
    pane.node.classList.remove('is-edit');pane.node.classList.toggle('is-draft',draft);pane.tools.hidden=!draft;pane.viewport.scrollTop=0;pane.viewport.scrollLeft=0;
    pane.whiteboard.setReadOnly(true);pane.whiteboard.load(entry.payload.draft);pane.whiteboard.setMode(draft?'draft':'practice');
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
function writeEditorDraft(pane,id,entry,snapshot){if(!collectionFeature(pane,'history')){entry.draft=structuredClone(snapshot.draft);entry.changed=snapshot.changed;return Promise.resolve();}const body=JSON.stringify({contentVersion:entry.value.draftVersion||entry.value.contentVersion,draft:snapshot.draft,changed:snapshot.changed});const task=(pane.editorDraftWrites||Promise.resolve()).catch(()=>{}).then(()=>request(editorDraftPath(pane,id),{method:'PUT',body}));pane.editorDraftWrites=task;return task;}
function newEditorSession(pane){return createEditorSession({ensureActive:id=>showEditorQuestion(pane,id),persistDraft:collectionFeature(pane,'history')?(id,entry,snapshot)=>writeEditorDraft(pane,id,entry,snapshot):undefined});}
async function persistEditorDraft(pane){
  clearTimeout(pane.editorTimer);pane.editorTimer=null;
  const qid=pane.questionId,entry=pane.editorSession?.get(qid);if(!entry?.plugin||pane.closed)return;
  const snapshot=await entry.plugin.exportDraft();if(!snapshot.supported)return;
  await writeEditorDraft(pane,qid,entry,snapshot);entry.changed=snapshot.changed;
}
function scheduleEditorDraft(pane){clearTimeout(pane.editorTimer);pane.editorTimer=setTimeout(()=>{persistEditorDraft(pane).catch(error=>{saveStatus('编辑草稿未保存','error');failure(error);});},600);}
async function showEditorQuestion(pane,qid){
  if(!canEditCollection(pane)||pane.closed)return;
  if(pane.view==='edit'&&pane.questionId===qid&&pane.plugin)return;
  pane.node.inert=true;if(!pane.development||!pane.plugin?.hasError)await pane.plugin?.flush();
  const oldPlugin=pane.plugin,session=pane.editorSession||newEditorSession(pane),old=session.get(pane.questionId);
  const previous={view:pane.view,questionId:pane.questionId,editState:pane.editState,editorSession:pane.editorSession};
  if(old)old.scrollTop=pane.viewport.scrollTop;
  let entry=session.get(qid);
  pane.loading=true;updateChrome();
  try{
    if(!entry?.plugin){
      await pane.editorDraftWrites;
      const value=await request(`${questionPath(pane.kind,pane.id,qid)}/editor`),savedDraft=collectionFeature(pane,'history')?await request(editorDraftPath(pane,qid)):{draft:entry?.draft||null,changed:!!entry?.changed,contentVersion:entry?.value.draftVersion||entry?.value.contentVersion};
      if(!value.editor)throw new Error('这个题型拓展尚未提供编辑器');
      if(savedDraft.draft!=null&&savedDraft.contentVersion!==(value.draftVersion||value.contentVersion)){
        if(savedDraft.changed!==false)throw new Error('题目已变更，旧编辑草稿仍保留，请先处理版本冲突。');
        savedDraft.draft=null;
      }
      value.editor=await prepareAssets(value.editor);
      if(!pane.development){if(old?.plugin){await session.suspend(pane.questionId);pane.plugin=null;}else if(oldPlugin){oldPlugin.destroy();pane.plugin=null;}}
      if(!entry)entry=session.add(qid,{id:qid,value,plugin:null,container:null,scrollTop:0});else entry.value=value;
      pane.editState=value;pane.editorSession=session;pane.view='edit';pane.questionId=qid;
      const container=el('div','editor-question-container');container.hidden=true;pane.frameHost.append(container);
      const plugin=mountExtension(container,value.editor,{mode:'edit',question:value.question,...(pane.development?{development:pane.development}:{}),capabilities:{canEdit:true}},{editorDraft:savedDraft.draft,onDirty:()=>scheduleEditorDraft(pane),onLayout:(options,frame)=>setEditorLayout(pane,options,frame),onRequest:(method,args)=>['resource-get','sdk-editor'].includes(method)||pane.plugin===plugin?pageRequest({...pane,view:'edit',editState:value},method,args):Promise.resolve({ok:false,error:{code:'READ_ONLY',message:'当前编辑题卡未处于活动状态'}}),onError:message=>{if(active()===pane){if(pane.development)showPageFailure(pane,new Error(message),qid);else notice(message);}}});
      try{
        await plugin.ready;
        if(pane.development){
          if(old?.plugin){try{await session.suspend(previous.questionId);}catch(error){if(session.values().filter(item=>item.plugin).length>=4)throw new Error('开发编辑器已有 4 张题卡保留未保存输入，请先完成保存。');old.container.hidden=true;}}
          else oldPlugin?.destroy();
        }
      }catch(error){plugin.destroy();container.remove();session.remove(qid);if(pane.development){Object.assign(pane,previous);pane.plugin=oldPlugin;}throw error;}
      entry.plugin=plugin;entry.container=container;entry.changed=!!savedDraft.changed;
    }
    // Invalid intermediate forms are persisted before the previous iframe
    // is released; only the target editor remains mounted.
    pane.editorSession=session;pane.view='edit';pane.questionId=qid;pane.outlineItemId=null;pane.editState=entry.value;pane.historyEntry=null;pane.historyView=null;pane.historyQuestion=null;pane.historyQuestionId=null;pane.plugin=entry.plugin;
    for(const item of session.values())if(item.container){item.container.hidden=item!==entry;item.plugin?.setActive?.(item===entry);}
    entry.container.hidden=false;pane.node.classList.remove('is-draft');pane.node.classList.add('is-edit');pane.tools.hidden=true;
    pane.whiteboard.setMode('practice');pane.viewport.scrollTop=entry.scrollTop;pane.viewport.scrollLeft=0;
    syncPracticeCamera(pane);saveStatus('编辑中');renderOutline();
  }catch(error){if(pane.development)showPageFailure(pane,error,qid);throw error;}finally{pane.loading=false;updateChrome();}
}
async function openEditor(pane){
  if(!canEditCollection(pane)||pane.view!=='practice')return;await flushPane(pane);
  if(!allowLeaveDevelopmentInput(pane))return;
  await showEditorQuestion(pane,pane.questionId);
}
async function saveEditor(pane){
  if(!canEditCollection(pane)||pane.view!=='edit'||pane.loading)return;
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
      if(collectionFeature(pane,'history'))await request(editorDraftPath(pane,id),{method:'DELETE'});entry.draft=null;entry.changed=false;
      if(id!==pane.questionId)session.remove(id);
      else{entry.plugin?.update({mode:'edit',question:entry.value.question,capabilities:{canEdit:true}});await entry.plugin?.flush();}
    });
    const collection=await request(collectionPath(pane.kind,pane.id)),payload=await loadQuestion(pane,pane.questionId);
    await showQuestion(pane,pane.questionId,{payload,collection});await refreshCatalog();notice(saved?`已保存 ${saved} 道题目的修改。${collectionFeature(pane,'history')?'旧历史记录保留。':''}`:'没有需要保存的修改。');
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
const developmentPath=pane=>`/api/development/${pane.kind==='development-bank'?'banks':'extensions'}/${encodeURIComponent(pane.id)}`;
function developmentTitle(){return '开发版';}
function syncDevelopmentCatalog(pane,descriptor){
  const rows=pane.kind==='development-bank'?catalog.banks:catalog.extensions,row=rows.find(value=>value.kind===pane.kind&&value.id===pane.id);
  if(!row)return;
  Object.assign(row,{development:pane.development,revision:descriptor.revision,questionCount:pane.collection.questions.length});delete row.mode;
  if(pane.kind==='development-bank')row.title=descriptor.title;else{row.name=descriptor.name||descriptor.title||descriptor.extension?.name;row.title=row.name;}
  delete row.error;delete row.errorCode;delete row.errorStatus;
}
async function prepareDevelopmentSettings(settings){
  const panes=[...collections.values()].filter(pane=>pane.development);
  for(const pane of panes){const saved=await flushPane(pane);if(!settings.enabled&&(saved===false||pane.retainedQuestions?.size)&&!confirm('关闭开发者模式会丢弃尚未保存的开发输入，是否继续？'))throw new Error('开发输入已保留，设置未更改');if(pane.view==='edit'){await persistEditorDraft(pane);await pane.editorDraftWrites;}}
  if(settings.enabled)return;
  // Keep persisted editor drafts: closing developer mode is not a discard action.
  for(const pane of panes){pane.closed=true;pane.developmentWatcher?.destroy();clearTimeout(pane.inkTimer);clearTimeout(pane.editorTimer);pane.sizeObserver?.disconnect();pane.worldObserver?.disconnect();if(pane.retainedQuestions)disposeRetainedQuestions(pane);disposeEditorSession(pane);disposeScoreSummary(pane);pane.plugin?.destroy();pane.whiteboard?.destroy();pane.node.remove();collections.delete(pane.key);questionsCache.deleteCollection(`${pane.key}:`);for(const prefix of unusedPagePrefixes(pane,collections.values()))pagesCache.deleteCollection(prefix);}
  if(!collections.has(activeKey)){activeKey=null;await activateReady([...collections.keys()].at(-1)||null);}else{updateChrome();}
}
function watchDevelopment(pane,descriptor){
  if(pane.developmentWatcher)return;
  pane.developmentWatcher=createDevelopmentWatcher({revision:descriptor.revision,check:()=>request(`${developmentPath(pane)}/revision`),
    reload:async(_revision,isCurrent)=>transitionTo(async()=>{
      if(pane.closed||pane.loading||!isCurrent())return false;
      if(pane.view==='edit'||pane.view==='history'||pane.view==='summary'){pane.needsRefresh=true;saveStatus('开发文件已更新，返回作答后刷新');return false;}
      if(await flushPane(pane)===false&&pane.plugin?.hasUnsavedInput){saveStatus('未保存输入已保留，完成保存后刷新','error');return false;}if(!isCurrent())return false;
      const next=await request(developmentPath(pane));if(!isCurrent())return false;
      const scroll=pane.viewport.scrollTop;
      const collection=await request(collectionPath(pane.kind,pane.id));if(!isCurrent())return false;
      const qid=collection.questions.some(row=>row.id===pane.questionId)?pane.questionId:collection.questions[0]?.id;
      if(!qid)throw new Error('开发版还没有可用的样例');
      questionsCache.deleteCollection(`${pane.key}:`);
      const payload=await loadQuestion(pane,qid,{fresh:true});if(!isCurrent())return false;
      await showQuestion(pane,qid,{collection,payload,preserveFrame:true,canCommit:isCurrent});
      pane.development={...next.development,folder:next.development?.folder||pane.development?.folder||pane.id};pane.developmentDescriptor=next;
      if(isCurrent()){pane.viewport.scrollTop=scroll;syncDevelopmentCatalog(pane,next);updateChrome();renderLibrary();}return isCurrent();
    }),onError:error=>{if(active()===pane)saveStatus(error.status===401?'预览连接已失效':'文件暂未就绪，保留上次预览','error');},
  });
  pane.developmentWatcher.setActive(active()===pane);
}
async function openCollection(kind,id){
  const key=`${kind}:${id}`;
  await flushPane(active());
  if(collections.has(key)){await activateReady(key);return;}
  let development;
  if(kind.startsWith('development'))development=await request(developmentPath({kind,id}));
  const collection=await request(collectionPath(kind,id));
  if(!collection.questions?.length)throw new Error('这个列表还没有题目');
  await suspendPane(active());
  collection.states ||= {};
  const node=el('section','question-pane'),tools=el('div','qf-whiteboard-tool-row'),viewport=el('div','question-viewport'),stage=el('div','question-stage'),world=el('div','question-world'),frameHost=el('div','question-frame-wrapper');
  tools.hidden=true;world.append(frameHost);stage.append(world);viewport.append(stage);node.append(tools,viewport);$('#panes').append(node);
  const pane={key,kind,id,collection,node,tools,viewport,stage,world,frameHost,questionId:null,payload:null,plugin:null,whiteboard:null,writes:null,ink:createDraftBuffer(),draftMode:false,historyDraftMode:false,view:'practice',historyEntry:null,historyRecords:[],historyView:null,historyQuestion:null,historyQuestionId:null,editState:null,editorSession:null,loading:true,closed:false,inkTimer:null};
  if(development){pane.development=development.development||{folder:id};pane.developmentDescriptor=development;}
  pane.writes=makeWriteQueue(pane);
  attachRuntime(pane);
  pane.sizeObserver=new ResizeObserver(()=>syncPracticeCamera(pane));pane.sizeObserver.observe(viewport);
  pane.worldObserver=new ResizeObserver(()=>syncPracticeCamera(pane));pane.worldObserver.observe(world);
  collections.set(key,pane);activate(key);
  if(development)watchDevelopment(pane,development);
  await showQuestion(pane,collection.questions[0].id);
}
function activate(key){const selected=collections.get(key);if(selected){collections.delete(key);collections.set(key,selected);}activeKey=key;notice('');for(const pane of collections.values()){pane.node.hidden=pane.key!==key;pane.plugin?.setActive?.(pane.key===key);pane.developmentWatcher?.setActive(pane.key===key);}$('#welcome').hidden=!!selected;renderLibrary();renderOutline();updateChrome();renderRecovery();closeDrawers();const pane=active();saveStatus(pane?.writes.hasFailures?'仍有内容未保存':pane?.view==='history'?'只读快照':pane?.view==='edit'?'编辑中':pane?.payload&&pane.payload.state.status!=='unanswered'?practiceSaveLabel(pane):'',pane?.writes.hasFailures?'error':'');}
function attachRuntime(pane){if(pane.whiteboard)return;pane.whiteboard=mountWhiteboard(pane.viewport,{toolbarContainer:pane.tools,onChange:value=>enqueueInk(pane,value),onViewChange:camera=>resizeStage(pane,camera),onFullscreen:()=>draftFullscreen.toggle()});pane.whiteboard.setFullscreenState(draftFullscreen.getState());pane.sizeObserver?.observe(pane.viewport);pane.worldObserver?.observe(pane.world);}
async function suspendPane(pane){
  if(!pane||pane.closed||!pane.whiteboard)return;
  const saved=await flushPane(pane);clearTimeout(pane.editorTimer);
  pane.savedScrollTop=pane.viewport.scrollTop;
  if(pane.development&&(saved===false||pane.retainedQuestions?.size)){pane.keepRuntime=true;pane.node.inert=true;return;}
  if(pane.view==='edit'){try{await pane.editorSession.suspend(pane.questionId);}catch(error){if(!pane.development)throw error;pane.keepRuntime=true;pane.node.inert=true;return;}pane.plugin=null;}
  else{pane.plugin?.destroy();pane.plugin=null;pane.frameHost.replaceChildren();if(pane.view==='history'){pane.pausedHistoryId=pane.historyEntry.id;pane.historyEntry={id:pane.historyEntry.id,collectionTitle:pane.historyEntry.collectionTitle};pane.historyView=null;pane.historyQuestion=null;}}
  pane.summaryCard?.destroy();pane.summaryCard=null;
  pane.whiteboard.destroy();pane.whiteboard=null;pane.tools.replaceChildren();pane.sizeObserver?.disconnect();pane.worldObserver?.disconnect();pane.payload=null;pane.collection.states={};
}
async function activateReady(key){
  if(activeKey!==key)await suspendPane(active());
  activate(key);const pane=collections.get(key);if(!pane)return;
  attachRuntime(pane);
  if(pane.development&&pane.keepRuntime&&pane.plugin){pane.keepRuntime=false;syncPracticeCamera(pane);return;}
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
function renderLibrary(){
  $('.library-switch').hidden=!catalog.developmentEnabled;if(!catalog.developmentEnabled)listMode='bank';
  $('#welcome p').textContent=catalog.developmentEnabled?'选择左侧题库，或到拓展列表体验样例。':'选择左侧题库，开始练习。';
  $('#show-banks').setAttribute('aria-selected',String(listMode==='bank'));$('#show-extensions').setAttribute('aria-selected',String(listMode==='extension'));$('#library-label').textContent=listMode==='bank'?'我的题库':'题型拓展';
  const root=$('#library-list');root.replaceChildren();const rows=listMode==='bank'?catalog.banks:catalog.extensions;
  const appendItem=(container,row)=>{const kind=row.kind?.startsWith('development')?row.kind:listMode,key=`${kind}:${row.id}`,button=el('button',`library-item${key===activeKey?' active':''}`);button.dataset.itemId=row.id;
    const body=el('span','item-body'),title=el('span','item-title',row.title||row.name);if(row.development)title.append(el('span','development-badge','开发版'));body.append(title);body.append(el('span',`item-meta${row.error?' item-error':''}`,row.error?(typeof row.error==='string'?row.error:row.error.message):`${row.questionCount??0} ${listMode==='bank'?'道题目':'道样例'}${row.version&&!row.development?' · v'+row.version:''}`));
    button.append(el('span','item-icon',listMode==='bank'?'▤':row.development?'⌘':'◇'),body);button.addEventListener('click',()=>{if(row.error){notice(typeof row.error==='string'?row.error:row.error.message);return;}transitionTo(()=>openCollection(kind,row.id));});container.append(button);
  };
  const appendGroups=(container,nodes)=>{for(const group of nodes){
    if(group.kind!=='group'){appendItem(container,group.row);continue;}
    const section=el('section','extension-group'),toggle=el('button','extension-group-toggle'),arrow=el('span','extension-group-arrow'),body=el('div','extension-group-body');
    toggle.type='button';toggle.dataset.extensionGroup=group.path;body.id=`extension-group-${encodeURIComponent(group.path)}`;toggle.setAttribute('aria-controls',body.id);arrow.setAttribute('aria-hidden','true');toggle.append(arrow,el('span','extension-group-label',group.name));
    const sync=()=>{const expanded=!collapsedExtensionGroups.has(group.path);body.hidden=!expanded;arrow.textContent=expanded?'▾':'▸';toggle.setAttribute('aria-expanded',String(expanded));toggle.setAttribute('aria-label',`${expanded?'折叠':'展开'} ${group.path}`);};
    toggle.addEventListener('click',()=>{if(collapsedExtensionGroups.has(group.path))collapsedExtensionGroups.delete(group.path);else collapsedExtensionGroups.add(group.path);sync();});sync();appendGroups(body,group.children);section.append(toggle,body);container.append(section);
  }};
  if(listMode==='extension')appendGroups(root,extensionGroups(rows));else for(const row of rows)appendItem(root,row);
  if(!rows.length)root.append(el('p','list-empty',listMode==='bank'?'目录中还没有题库。添加文件后刷新列表。':'目录中还没有拓展。添加文件后刷新列表。'));
}
function renderOutline(){
  const pane=active(),root=$('#outline-list');root.replaceChildren();const rows=visibleQuestions(pane),qid=visibleQuestionId(pane);
  const roundScores=new Map(pane?.summaryShown?(pane.scoreSummary?.questions||[]).map(question=>[question.id,question]):[]);
  const statusLabels={unanswered:'未作答',correct:'正确',incorrect:'错误'};
  for(const group of consecutiveQuestionGroups(rows,pane?.view==='history'?pane.historyView.extension:pane?.collection.extension)){
    const section=el('section','outline-group'),matrix=el('div','outline-matrix');section.append(el('h2','outline-group-title',group.name),matrix);root.append(section);
    for(const {question:row,number}of group.items){
    const children=row.outlineItems||[],label=String(row.outlineLabel??number),state=stateFor(pane,row.id),roundScore=roundScores.get(row.id),submitted=roundScore?roundScore.submitted===true:state.status==='submitted';
    const jump=itemId=>transitionTo(async()=>{await navigateOutlineTarget(pane,row.id,itemId,{navigateQuestion,renderOutline});closeDrawers();});
    if(children.length){
      const details=Array.isArray(roundScore?.outlineStates)?roundScore.outlineStates:roundScore&&!roundScore.submitted&&state.status==='submitted'?[]:state.outlineStates;
      const childStates=new Map((Array.isArray(details)?details:[]).filter(item=>typeof item?.id==='string'&&Object.hasOwn(statusLabels,item.status)).map(item=>[item.id,item.status]));
      for(const item of children){
        const status=submitted?(childStates.get(item.id)||''):'unanswered';
        const selected=row.id===qid&&pane.outlineItemId===item.id,child=el('button',`outline-item outline-child ${status}${selected?' active':''}`,item.label);
        const statusLabel=statusLabels[status]||'未提供小题状态';
        child.type='button';child.dataset.questionId=row.id;child.dataset.outlineItemId=item.id;child.title=`第 ${label} 题 · ${item.label} · ${statusLabel}`;child.setAttribute('aria-label',`第 ${label} 题，小题 ${item.label}：${statusLabel}`);child.setAttribute('aria-current',selected?'true':'false');
        child.addEventListener('click',()=>jump(item.id));matrix.append(child);
      }
      continue;
    }
    const result=roundScore||state.result;
    const status=!submitted?'unanswered':Number.isFinite(result?.score)&&Number.isFinite(result?.maxScore)&&result.score===result.maxScore?'correct':'incorrect';
    const parentActive=row.id===qid;
    const button=el('button',`outline-item ${status}${parentActive?' active':''}`,label);button.type='button';button.dataset.questionId=row.id;button.setAttribute('aria-current',parentActive?'true':'false');button.setAttribute('aria-label',`第 ${label} 题：${row.title}`);button.title=`第 ${label} 题 · ${row.title}`;
    button.addEventListener('click',()=>jump(null));matrix.append(button);
    }
  }
  if(hasScoreSummary(pane)){const button=el('button',`outline-score-summary${pane.summaryShown?' active':''}`,'分值汇总');button.addEventListener('click',()=>transitionTo(async()=>{await showScoreSummary(pane);closeDrawers();}));root.append(button);}
}
function updateChrome(){
  draftFullscreen.sync();
  const pane=active(),view=pane?.view,draft=draftViewActive(pane),draftButton=$('#draft-toggle');draftButton.hidden=!canViewDraft(pane);draftButton.disabled=!!pane?.loading;draftButton.setAttribute('aria-pressed',String(draft));draftButton.replaceChildren(el('span','','✎'),document.createTextNode(draft?(view==='history'?' 返回练习':' 返回作答'):' 草稿'));
  $('#history-open').hidden=!pane?.payload||!collectionFeature(pane,'history')||!!pane.summaryShown&&!pane.scoreSummary?.historyId;$('#history-open').disabled=!!pane?.loading;
  $('#edit-open').hidden=!pane?.payload||!canEditCollection(pane)||view!=='practice';$('#edit-open').disabled=!!pane?.loading;
  $('#development-badge').hidden=!pane?.development;$('#development-badge').textContent=pane?.development?developmentTitle(pane):'';
  for(const id of ['development-edit','development-return','development-publish-open'])$(`#${id}`).hidden=true;
  $('#mode-bar').hidden=!pane||['practice','summary'].includes(view);
  $('#history-choose').hidden=!collectionFeature(pane,'history')||!['history','history-deleted'].includes(view);$('#return-practice').hidden=!['history','history-deleted'].includes(view);
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
  try{
    const [value,settings]=await Promise.all([request('/api/catalog',{timeoutMs:60000}),request('/api/settings/development')]);
    const returnToBanks=listMode==='extension'||catalog.developmentEnabled&&!active()||['extension','development','development-bank'].includes(active()?.kind);
    catalog.banks=value.banks;catalog.extensions=value.extensions;catalog.developmentEnabled=settings.enabled===true;renderLibrary();
    if(!catalog.developmentEnabled&&returnToBanks){
      const previous=[...collections.values()].filter(pane=>pane.kind==='bank'&&catalog.banks.some(row=>row.id===pane.id&&!row.error)).at(-1),first=catalog.banks.find(row=>!row.error);
      if(previous||first)await openCollection(previous?.kind||first.kind||'bank',previous?.id||first.id);
      else{await suspendPane(active());activate(null);}
    }
  }
  catch(error){if(error.status===401){if(!$('#access-dialog').open)$('#access-dialog').showModal();}else throw error;}
  finally{button.classList.remove('is-loading');}
}
function switchList(kind){if(kind==='extension'&&!catalog.developmentEnabled)return;listMode=kind;renderLibrary();const open=[...collections.values()].filter(pane=>kind==='bank'?['bank','development-bank'].includes(pane.kind):['extension','development'].includes(pane.kind)).at(-1);const first=(kind==='bank'?catalog.banks:catalog.extensions).find(row=>!row.error);if(open||first)transitionTo(()=>openCollection(open?.kind||first.kind||kind,open?.id||first.id));}
$('#show-banks').addEventListener('click',()=>switchList('bank'));$('#show-extensions').addEventListener('click',()=>switchList('extension'));
$('#refresh').addEventListener('click',()=>transitionTo(async()=>{for(const pane of collections.values())await flushPane(pane);questionsCache.clear();pagesCache.clear();await refreshCatalog();for(const pane of collections.values())pane.needsRefresh=true;if(activeKey)await activateReady(activeKey);}));
$('#retry-save').addEventListener('click',()=>transitionTo(async()=>{const pane=active();if(!pane)return;pane.node.inert=true;await pane.plugin?.flush();pane.whiteboard.flush();await pane.writes.settled();await saveInk(pane);for(const value of pane.writes.failures){await pane.writes.enqueue(value.questionId,value.action,value.data,{contentVersion:value.contentVersion});}if(!pane.writes.hasFailures)notice('');}));
$('#load-saved').addEventListener('click',()=>{const pane=active();if(!pane||!confirm('读取服务器状态会放弃当前未保存的答案和笔迹，是否继续？'))return;transitionTo(async()=>{pane.node.inert=true;await pane.plugin?.flush();await pane.writes.settled();const payload=await loadQuestion(pane,pane.questionId,{fresh:true});clearTimeout(pane.inkTimer);pane.inkTimer=null;pane.ink.clear();pane.writes.clear();await showQuestion(pane,pane.questionId,{payload});notice(collectionFeature(pane,'history')?'已读取服务器保存的状态。':'已读取当前会话状态。');});});
$('#draft-toggle').addEventListener('click',()=>transitionTo(()=>toggleDraftMode()));
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
phoneLayout.addEventListener('change',()=>{for(const pane of collections.values())syncPracticeCamera(pane);});
$('#scrim').addEventListener('click',closeDrawers);syncSidebars();
bindAiSettings({request});
bindNetworkSettings({request,beforeSave:()=>transitionTo(async()=>{for(const pane of collections.values())await flushPane(pane);})});
bindDevelopmentSettings({request,beforeSave:settings=>transitionTo(()=>prepareDevelopmentSettings(settings)),onSaved:settings=>transitionTo(async()=>{for(const pane of collections.values())if(pane.development&&settings.enabled)pane.developmentWatcher?.invalidate();await refreshCatalog();})});
document.addEventListener('quizforge-auth-required',()=>{const dialog=$('#access-dialog');if(!dialog.open)dialog.showModal();});
$('#access-form').addEventListener('submit',async event=>{
  event.preventDefault();const button=event.currentTarget.querySelector('button[type="submit"]');if(button.disabled)return;
  button.disabled=true;$('#access-error').textContent='';
  try{const value=await request('/api/auth/login',{method:'POST',body:JSON.stringify({password:$('#access-token').value})});setAccessToken(value.token);$('#access-token').value='';$('#access-dialog').close();await start();}
  catch(error){$('#access-error').textContent=error.code==='PASSWORD_REQUIRED'||error.code==='TOKEN_REQUIRED'?'密码不正确，请重试。':error.code==='LOGIN_RATE_LIMITED'?'尝试次数过多，请等待一分钟后再连接。':error.message;}
  finally{button.disabled=false;}
});
window.addEventListener('beforeunload',event=>{if(pendingWrites||[...collections.values()].some(pane=>pane.ink.pending||pane.writes.hasFailures||pane.editorSession?.isDirty||pane.plugin?.hasUnsavedInput||pane.retainedQuestions?.size)){event.preventDefault();event.returnValue='';}});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'){const pane=active();if(pane&&!pane.loading&&pane.view==='practice'){pane.whiteboard.flush();saveInk(pane).catch(()=>{});}}});
async function start(){await refreshCatalog();const first=catalog.banks.find(row=>!row.error);if(first&&!collections.size)await transitionTo(()=>openCollection(first.kind||'bank',first.id));}
start().catch(failure);
