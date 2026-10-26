import {createListeningPlayer} from './listening/listening-player.js';
import {createLibraryIndexClient} from './library/library-index-client.js';
import {createCollectionLoading} from './practice/collection-loading.js';
import {reportAnswerPreview,previewDraftAnswer,confirmAnswerPreview,answerStateForSave} from './practice/answer-preview.js';
import {request,readResource,setAccessToken,collectionPath,questionPath,makeRequestId} from './shared/api.js';
import {mountExtension} from './bridge/frame.js';
import {prepareExtensionAssets} from './bridge/page-assets.js';
import {mountWhiteboard} from './draft/whiteboard.js';
import {createWriteQueue,createDraftBuffer} from './shared/write-queue.js';
import {createQuestionCache} from './practice/question-cache.js';
import {navigateOutlineTarget} from './outline/outline-navigation.js';
import {syncQuestionLayout,rememberDraftView,rememberDraftScroll} from './practice/question-layout.js';
import {createHistoryView,historyProgress} from './history/history-view.js';
import {createEditorSession} from './editor/editor-session.js';
import {checkEditorExit,renderEditorStatus,bindEditorLeaveNotice,shouldWarnBeforeUnload} from './editor/editor-navigation.js';
import {mountPracticeSummary} from './practice/practice-summary.js';
import {bindNetworkSettings} from './shell/network-settings.js';
import {bindAiSettings} from './ai/ai-settings.js';
import {bindUserCenter} from './ai/user-center.js';
import {createHubLogin} from './ai/hub-login.js';
import {bindExamMode} from './exam/exam-mode.js';
import {bindDevelopmentSettings} from './development/development-settings.js';
import {createDevelopmentWatcher} from './development/development-watch.js';
import {createAiClient} from './ai/ai-client.js';
import {createDraftFullscreen} from './draft/draft-fullscreen.js';
import {visibleQuestions,visibleQuestionId,hasScoreSummary,navigationIndex,stateFor,contextFor,collectionFeature,canEditCollection,practiceSaveLabel,canViewDraft,draftViewActive,examActive} from './practice/practice-context.js';
import {createExtensionRouter} from './bridge/extension-requests.js';
import {questionExtension,collectionHasExtension,extensionPageRoute,sameQuestionStamp,unusedPagePrefixes} from './bridge/extension-pages.js';
import {renderLibraryView} from './library/library-view.js';
import {renderOutlineView} from './outline/outline-view.js';
import {bindLibraryManagement} from './library/library-management.js';
import {takeImportedBank} from './library/native-import.js';
import {bindLibraryTransfer} from './library/library-transfer.js';
import {bindLibraryResize} from './library/library-resize.js';
import {bindSaveRecovery} from './practice/save-recovery.js';
import {bindAppearanceSettings} from './shell/appearance.js';
import {createQuestionStepper,stepTarget,adjacentQuestionIds,navigationShortcut,scheduleIdle} from './practice/question-navigation.js';

const $=selector=>document.querySelector(selector);
const catalog={banks:[],extensions:[],groups:{banks:[],extensions:[]},canManage:false,developmentEnabled:false},collections=new Map();
const collapsedExtensionGroups=new Set();
const questionsCache=createQuestionCache(),pagesCache=createQuestionCache({capacity:4,maxBytes:4*1024*1024});
const sdkCache=createQuestionCache({capacity:4,maxBytes:8*1024*1024});
const collectionLoading=createCollectionLoading(document);
async function prepareAssets(assets){return prepareExtensionAssets(assets,dependency=>sdkCache.load(`${dependency.id}:${dependency.version}:static`,()=>request(`/api/sdk/${encodeURIComponent(dependency.id)}/${encodeURIComponent(dependency.version)}`)));}
const sidebarPreferences={library:true,outline:true};
try{const saved=JSON.parse(localStorage.getItem('quizforge-sidebars')||'{}');for(const key of Object.keys(sidebarPreferences))if(typeof saved[key]==='boolean')sidebarPreferences[key]=saved[key];}catch{}
const libraryDrawer=matchMedia('(max-width:800px)'),outlineDrawer=matchMedia('(max-width:1100px)');
const phoneLayout=matchMedia('(max-width:600px)');
let listMode='bank',activeKey=null,pendingLibraryKey=null,transition=Promise.resolve(),pendingWrites=0;
const el=(tag,className,text)=>{const node=document.createElement(tag);if(className)node.className=className;if(text!=null)node.textContent=text;return node;};
// Apply the saved appearance before the first question renders.
bindAppearanceSettings({document});
function notice(message){$('#notice').textContent=message||'';$('#notice').hidden=!message;}
function failure(error){notice(error.message||String(error));if(error.code==='UNSAVED_EDITOR_CHANGES')showEditorLeaveNotice(error);}
function transitionTo(fn){const run=transition.then(async()=>{notice('');$('#previous').disabled=true;$('#next').disabled=true;try{return await fn();}finally{for(const pane of collections.values())pane.node.inert=false;updateChrome();renderRecovery();}});transition=run.catch(()=>{});run.catch(failure);return run;}
const active=()=>collections.get(activeKey);
const showEditorLeaveNotice=bindEditorLeaveNotice(document);
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
    if(cached?.stamp){const value=await request(questionPath(pane.kind,pane.id,qid),{headers:{'X-QuizForge-Question-Stamp':JSON.stringify(cached.stamp)}});if(value.unchanged&&sameQuestionStamp(value.stamp,cached.stamp)){cacheHit=true;return cached;}return value;}
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
      if(pane.questionId===qid){pane.payload=value;if(action==='retry'&&pane.plugin?.frame?.qfSharedAnswerAreas?.length){const before=pane.whiteboard.getDraft?.()?.strokes||[],kept=new Set((value.draft?.strokes||[]).map(stroke=>stroke.id));pane.ink.clear();clearTimeout(pane.inkTimer);pane.inkTimer=null;pane.whiteboard.load(value.draft);pane.whiteboard.forgetAnswerInk?.(before.map(stroke=>stroke.id).filter(id=>!kept.has(id)));}if(action!=='whiteboard'&&action!=='draft')pane.plugin?.update(contextFor(pane));}
      if(active()===pane){renderOutline();updateChrome();saveStatus(pane.writes.hasFailures?'仍有内容未保存':pane.answerPreviews?.size?'答案尚未保存':practiceSaveLabel(pane),pane.writes.hasFailures?'error':pane.answerPreviews?.size?'saving':'');renderRecovery();}
    },
    onFailed:async(qid,_action,error)=>{
      if(error.status===409){try{const latest=await loadQuestion(pane,qid,{fresh:true});pane.collection.states[qid]=latest.state;if(pane.questionId===qid)pane.payload=latest;if(active()===pane)renderOutline();}catch{/* Keep the failed input locally until a confirmed retry. */}}
      if(active()===pane){saveStatus('保存失败','error');failure(error);renderRecovery();}
    }
  });}
async function mutate(pane,action,data,options={}){
  if(action==='whiteboard'&&!collectionFeature(pane,'whiteboard'))throw Object.assign(new Error('题库未开放草稿白板'),{code:'FEATURE_DISABLED'});
  const qid=pane.questionId,contentVersion=pane.renderedContentVersion,answerState=action==='draft'?answerStateForSave(pane,qid,options.answerStateId):null,preview=action==='draft'?previewDraftAnswer(pane,qid,options.answerStateId):null;
  if(preview&&active()===pane){renderOutline();saveStatus('保存中…','saving');}
  if(action==='submit'||action==='retry'&&pane.plugin?.frame?.qfSharedAnswerAreas?.length){pane.whiteboard.flush();await saveInk(pane);}
  const value=await pane.writes.enqueue(qid,action,answerState?{...data,answerState}:data,{contentVersion});
  if(preview)confirmAnswerPreview(pane,qid,preview);
  if(action==='submit'||action==='retry')pane.answerPreviews?.delete(qid);
  for(const [stateId,snapshot]of pane.answerStateSnapshots||[])if(snapshot.qid===qid&&(['submit','retry'].includes(action)||stateId===options.answerStateId))pane.answerStateSnapshots.delete(stateId);
  if(active()===pane){renderOutline();saveStatus(pane.writes.hasFailures?'仍有内容未保存':pane.answerPreviews?.size?'答案尚未保存':practiceSaveLabel(pane),pane.writes.hasFailures?'error':pane.answerPreviews?.size?'saving':'');}
  return {ok:true,data:{status:value.state.status,result:value.state.result}};
}
function renderRecovery(){
  const pane=active(),failed=pane?.writes.failures||[];
  $('#save-recovery').hidden=!failed.length;
  $('#recovery-message').textContent=failed.some(value=>value.error.code==='CONTENT_CONFLICT')?'题目内容已更改，当前输入仍保留。请读取已保存内容后重新作答。':failed.some(value=>value.error.status===409)?'保存状态发生冲突。当前输入仍保留，可重试，或读取已保存的内容。':pane?.development?'仍有内容未保存，当前输入保留。可以切题后返回重试。':'仍有内容未保存，切题已暂停。当前输入仍保留。';
}
function enqueueInk(pane,value){
  if(pane.loading||pane.recovering||pane.closed||!pane.questionId||pane.view!=='practice'||!collectionFeature(pane,'whiteboard'))return;
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
  if(pane.exam&&!examActive(pane)){await pane.writes.settled();return true;}
  pane.node.inert=true;
  try{
    if(!pane.development||!pane.plugin?.hasError)await pane.plugin?.flush();
    if(pane.view!=='practice')return true;
    pane.whiteboard?.flush();await saveInk(pane);await pane.writes.settled();
    if(pane.writes.hasFailures)throw Object.assign(new Error('保存未完成，当前输入已保留。请重试保存，或读取已保存内容。'),{code:'SAVE_FAILED'});
    const saved=!pane.plugin?.hasUnsavedInput;
    if(saved&&pane.keepRuntime&&!pane.plugin?.hasError){pane.keepRuntime=false;clearPageFailure(pane);}
    return saved;
  }catch(error){
    if(!pane.development)throw error;
    pane.keepRuntime=true;if(active()===pane){saveStatus('开发功能尚未完成，当前输入保留','error');notice(error.message);}
    return false;
  }
}
const pageRequest=createExtensionRouter({
  readResource:(id,pane)=>pane.exam?request(`${collectionPath('exam',pane.id)}/resources/${id}`):readResource(id,{development:pane.kind.startsWith('development')}),
  uploadResource:(args,pane)=>request(pane.exam?`${collectionPath('exam',pane.id)}/resources`:`/api/${pane.kind.startsWith('development')?'development/':''}resources`,{method:'POST',headers:pane.view==='practice'&&!collectionFeature(pane,'history')?{'X-QuizForge-Transient-Resource':'true'}:{},body:JSON.stringify(args)}),
  loadSdk:(id,version)=>sdkCache.load(`${id}:${version}:editor`,()=>request(`/api/sdk/${encodeURIComponent(id)}/${encodeURIComponent(version)}/editor`)),
  save:mutate,
  reportAnswerState:(pane,value)=>{const entry=reportAnswerPreview(pane,value);if(active()===pane){renderOutline();saveStatus('答案尚未保存','saving');}return Promise.resolve({ok:true,data:{status:'reported',stateId:entry.stateId}});},
  navigate:(pane,id)=>transitionTo(()=>navigateQuestion(pane,id)),
  summary:pane=>transitionTo(()=>showScoreSummary(pane)),
  ai:requestAi,
});
function requestAi(pane,method,args){
    const qid=pane.questionId;
    const client=createAiClient({request,path:questionPath(pane.kind,pane.id,qid),makeRequestId,confirmations:pane.aiConfirmations??=new Map(),
      shouldRefreshTask:task=>{const result=stateFor(pane,qid).result,assessment=task.targetId===undefined?result?.aiAssessment:result?.aiAssessments?.[task.targetId];return result?.gradingStatus==='pending'||assessment?.taskId!==task.taskId;},
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
    const page=pane.exam?{key:`exam:${pane.id}:${qid}`,path:`${questionPath('exam',pane.id,qid)}/page`}:extensionPageRoute(pkg,payload.stamp?.packageVersion);
    const assets=await prepareAssets(await pagesCache.load(page.key,()=>request(page.path)));
    {
      candidateHost=el('div','development-preview-candidate');pane.frameHost.append(candidateHost);
      candidatePlugin=mountExtension(candidateHost,assets,contextFor({...pane,collection:descriptor,questionId:qid,payload,view:'practice'}),{onLayout:(options,frame)=>setEditorLayout(pane,options,frame),onRequest:(method,args)=>!pane.recovering&&pane.plugin===candidatePlugin&&pane.questionId===qid?pageRequest(pane,method,args):['resource-get','sdk-editor'].includes(method)?pageRequest({...pane,view:'development-loading',pageAssets:assets},method,args):Promise.resolve({ok:false,error:{code:'READ_ONLY',message:'当前题卡未处于活动状态'}}),onError:message=>{if(!pane.closed&&pane.plugin===candidatePlugin)showPageFailure(pane,new Error(message));}});
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
    pane.draftLayoutPending=!payload.draft;
    const zoom=Math.max(.25,Math.min(1,(pane.viewport.clientWidth-24)/760));
    const draft=collectionFeature(pane,'whiteboard')&&structuredClone(payload.draft)||{schemaVersion:1,viewport:{x:(pane.viewport.clientWidth/zoom-760)/2,y:0,zoom},strokes:[],paper:{color:'#ffffff',pattern:'plain'}};
    pane.whiteboard.setReadOnly(!!pane.exam&&!examActive(pane));pane.whiteboard.load(draft);pane.tools.hidden=!pane.draftMode;pane.whiteboard.setMode(pane.draftMode?'draft':'practice');
    syncPracticeCamera(pane);
    pane.plugin=candidatePlugin;
    await pane.plugin.ready;
    pane.keepRuntime=false;clearPageFailure(pane);
    syncPracticeCamera(pane);
    pane.viewport.scrollTop=0;if(active()===pane){renderOutline();updateChrome();saveStatus(pane.payload.state.status==='unanswered'?'':practiceSaveLabel(pane));}
    if(pane.restartApplied){pane.scoreSummary=null;pane.restartRequest=null;pane.restartApplied=false;}
    prefetchAdjacent(pane);
  }catch(error){if(candidatePlugin&&pane.plugin!==candidatePlugin){candidatePlugin.destroy();candidateHost?.remove();}if(!pane.plugin&&!pane.questionId)pane.questionId=qid;showPageFailure(pane,error,qid);throw error;}
  finally{pane.loading=false;if(pane.plugin&&!pane.pageFailure)syncPracticeCamera(pane);clearTimeout(loadingTimer);loading.remove();pane.node.dataset.loadMs=String(Math.round(performance.now()-started));}
}
function clearPageFailure(pane){pane.errorBox?.remove();pane.errorBox=null;pane.pageFailure=null;}
function showPageFailure(pane,error,qid=pane.questionId){
  if(pane.closed)return;clearPageFailure(pane);pane.pageFailure={error,qid};
  const box=el('div','question-error'),message=el('p','',String(error.message||error).slice(0,1000)),retry=el('button','','重新加载题卡');
  box.setAttribute('role','alert');retry.type='button';retry.addEventListener('click',()=>transitionTo(async()=>{
    if(pane.closed)return;
    await allowDiscardEditor(pane);
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
  retained.set(pane.questionId,{plugin:pane.plugin,host,payload:pane.payload,pageAssets:pane.pageAssets,contentVersion:pane.renderedContentVersion,draft:pane.whiteboard.getDraft(),ink:pane.ink,scrollTop:pane.viewport.scrollTop,draftMode:pane.draftMode,draftLayoutPending:pane.draftLayoutPending});
  pane.plugin=null;pane.ink=createDraftBuffer();pane.keepRuntime=false;clearPageFailure(pane);
}
function restoreDevelopmentQuestion(pane,qid){
  const value=pane.retainedQuestions?.get(qid);if(!value)return false;
  pane.plugin?.destroy();for(const child of [...pane.frameHost.children])if(child!==value.host&&!child.classList.contains('development-retained-question'))child.remove();
  pane.retainedQuestions.delete(qid);value.host.hidden=false;value.host.classList.remove('development-retained-question');pane.plugin=value.plugin;pane.payload=value.payload;pane.pageAssets=value.pageAssets;pane.questionId=qid;pane.renderedContentVersion=value.contentVersion;pane.ink=value.ink;pane.draftMode=value.draftMode;pane.plugin.setActive?.(true);
  pane.draftLayoutPending=value.draftLayoutPending;pane.whiteboard.load(value.draft);pane.whiteboard.setMode(pane.draftMode?'draft':'practice');pane.tools.hidden=!pane.draftMode;pane.node.classList.toggle('is-draft',pane.draftMode);pane.viewport.scrollTop=value.scrollTop;clearPageFailure(pane);syncPracticeCamera(pane);renderOutline();updateChrome();return true;
}
function disposeRetainedQuestions(pane){for(const value of pane.retainedQuestions?.values()||[]){value.plugin.destroy();value.host.remove();}pane.retainedQuestions?.clear();}
function allowLeaveDevelopmentInput(pane){
  if(!pane.development||!(pane.plugin?.hasUnsavedInput||pane.keepRuntime||pane.retainedQuestions?.size))return true;
  if(!confirm('开发题卡仍有未保存输入，切换模式会丢弃这些输入，是否继续？'))return false;
  disposeRetainedQuestions(pane);return true;
}
async function toggleDraftMode(pane=active()){
  if(!canViewDraft(pane)||pane.loading)return;
  if(pane.view==='practice'&&await flushPane(pane)===false)return;
  const key=pane.view==='history'?'historyDraftMode':'draftMode';
  pane[key]=!pane[key];
  const draft=draftViewActive(pane);
  pane.node.classList.toggle('is-draft',draft);pane.tools.hidden=!draft;
  pane.viewport.scrollTop=0;pane.viewport.scrollLeft=0;
  pane.whiteboard.setMode(draft?'draft':'practice');syncPracticeCamera(pane);updateChrome();
}
function syncPracticeCamera(pane){
  if(pane.closed||pane.richtextFrame||!pane.whiteboard||pane.viewport.clientWidth<100)return;
  if(pane.view!=='edit')syncQuestionLayout(pane,draftViewActive(pane));
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
  const fluid=!draftViewActive(pane)&&pane.view!=='edit';
  const height=fluid?Math.max(pane.viewport.clientHeight,pane.world.offsetHeight):pane.view==='edit'?pane.world.offsetHeight:draftViewActive(pane)?pane.world.offsetHeight*camera.zoom+Math.max(0,camera.y*camera.zoom):Math.max(pane.viewport.clientHeight,(34+(pane.plugin?.frame.offsetHeight||pane.frameHost.offsetHeight)+camera.y)*camera.zoom+24);
  pane.stage.style.height=`${Math.max(1,height)}px`;
  if(pane.draftScrollRestore!=null&&!pane.loading){pane.viewport.scrollTop=pane.draftScrollRestore;pane.draftScrollRestore=null;}
}
async function allowDiscardEditor(pane,{discard=false}={}){
  if(pane?.view!=='edit')return true;
  pane.node.inert=true;
  return checkEditorExit(pane,{discard,confirmDiscard:message=>confirm(message)});
}
// Warm the neighbouring cards while idle. Navigation still revalidates the
// stamp, so a prefetched payload only turns the next read into a short reply.
function prefetchAdjacent(pane){
  pane.cancelPrefetch?.();pane.cancelPrefetch=null;
  if(pane.closed||pane.development||pane.view!=='practice')return;
  const questionId=pane.questionId;
  pane.cancelPrefetch=scheduleIdle(async()=>{
    pane.cancelPrefetch=null;
    const current=()=>!pane.closed&&active()===pane&&pane.view==='practice'&&pane.questionId===questionId;
    if(!current())return;
    for(const qid of adjacentQuestionIds(visibleQuestions(pane),navigationIndex(pane))){
      if(!current())return;
      try{
        const payload=await questionsCache.load(questionCacheKey(pane,qid),()=>request(questionPath(pane.kind,pane.id,qid))),pkg=questionExtension(payload,pane.collection,qid);
        if(!current()||!collectionHasExtension(pane.collection,qid,pkg))continue;
        const page=pane.exam?{key:`exam:${pane.id}:${qid}`,path:`${questionPath('exam',pane.id,qid)}/page`}:extensionPageRoute(pkg,payload.stamp?.packageVersion);
        await prepareAssets(await pagesCache.load(page.key,()=>request(page.path)));
      }catch{/* Best effort: the real switch reports load failures. */}
    }
  });
}
async function navigateQuestion(pane,qid){
  if(pane.view==='edit'&&pane.questionId===qid)return;
  if(pane.view==='history'){await showHistoryQuestion(pane,qid);return;}
  if(!await allowDiscardEditor(pane))return;
  const saved=await flushPane(pane),previousId=pane.questionId;
  if(pane.development&&saved===false)parkDevelopmentQuestion(pane);
  if(pane.development&&restoreDevelopmentQuestion(pane,qid))return;
  try{await showQuestion(pane,qid);}catch(error){if(pane.development)restoreDevelopmentQuestion(pane,previousId);throw error;}
}
async function returnToPractice(pane,options){
  const editing=pane?.view==='edit';
  if(!await allowDiscardEditor(pane,options))return false;
  if(!editing)await flushPane(pane);const collection=await request(collectionPath(pane.kind,pane.id));
  const qid=collection.questions.some(row=>row.id===pane.questionId)?pane.questionId:collection.questions[0]?.id;
  if(!qid)throw new Error('题库中没有题目');await showQuestion(pane,qid,{collection});return true;
}
async function showScoreSummary(pane){
  if(!await allowDiscardEditor(pane))return;
  if(!hasScoreSummary(pane))return;const history=pane.view==='history';
  if(await flushPane(pane)===false){saveStatus('答案尚未保存，请先完成保存后再查看汇总','error');return;}
  if(!allowLeaveDevelopmentInput(pane))return;pane.loading=true;updateChrome();
  try{
    const summary=history?pane.historyEntry.summary:await request(`${collectionPath(pane.kind,pane.id)}/summary`);
    disposeEditorSession(pane);disposeScoreSummary(pane);pane.plugin?.destroy();pane.plugin=null;pane.frameHost.replaceChildren();
    pane.view=history?'history':'summary';pane.summaryShown=true;pane.outlineItemId=null;pane.scoreSummary=summary;
    pane.node.classList.remove('is-edit','is-draft');pane.node.classList.add('is-summary');pane.tools.hidden=true;
    pane.whiteboard.load(null);pane.whiteboard.setMode('practice');pane.viewport.scrollTop=0;pane.viewport.scrollLeft=0;
    pane.summaryCard=mountPracticeSummary(pane.frameHost,summary,{readonly:history||!!pane.exam,history:collectionFeature(pane,'history'),exam:!!pane.exam,onFinish:value=>finishPractice(pane,value),onRestart:value=>restartPractice(pane,value)});
    syncPracticeCamera(pane);renderOutline();saveStatus(pane.exam?'':history?'只读汇总':summary.finished?(collectionFeature(pane,'history')?'练习已完成':'当前会话 · 已完成'):'');
  }finally{pane.loading=false;updateChrome();}
}
async function finishPractice(pane,summary){
  if (summary.answeredUnsubmittedCount > 0 && !confirm(`还有 ${summary.answeredUnsubmittedCount} 道已作答题目未提交，完成练习将统一提交评分。是否继续？`)) return summary;
  return transitionTo(async()=>{
    pane.loading=true;pendingWrites++;pane.node.inert=true;updateChrome();saveStatus(collectionFeature(pane,'history')?'保存中…':'当前会话 · 正在完成','saving');
    try{
      if(!pane.finishRequest||pane.finishRequest.summaryVersion!==summary.summaryVersion)pane.finishRequest={requestId:makeRequestId(),roundId:summary.roundId,summaryVersion:summary.summaryVersion};
      const value=await request(`${collectionPath(pane.kind,pane.id)}/finish`,{method:'POST',body:JSON.stringify(pane.finishRequest),timeoutMs:135000});
      questionsCache.deleteCollection(`${pane.key}:`);pane.scoreSummary=value;pane.historyRecords=[];pane.finishRequest=null;
      pane.collection=await request(collectionPath(pane.kind,pane.id));renderOutline();
      saveStatus(value.completionPending?'答案已提交，部分题目待评分；可返回题目重试 AI 或人工评分':value.historyId?'练习已完成':'当前会话 · 已完成');return value;
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
        await request(`${collectionPath(pane.kind,pane.id)}/restart`,{method:'POST',body:JSON.stringify(pane.restartRequest),timeoutMs:135000});
        pane.restartApplied=true;pane.finishRequest=null;pane.historyRecords=[];pane.answerPreviews?.clear();pane.answerStateSnapshots?.clear();
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
const historyPath=pane=>`${collectionPath(pane.exam?.bankKind??pane.kind,pane.exam?.bankId??pane.id)}/history`;
const historyTime=value=>new Date(value).toLocaleString('zh-CN',{hour12:false});
let historyDeleting=false,historyDeleteDecision=null;
function historyError(message=''){const node=$('#history-error');node.textContent=message;node.hidden=!message;}
function confirmHistoryDelete(row){
  $('#history-delete-detail').textContent=`${row.mode==='exam'?'考试 · ':''}${row.collectionTitle} · ${historyTime(row.createdAt)}`;
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
    const title=el('strong','',row.collectionTitle);if(row.mode==='exam')title.append(el('span','history-exam-badge','考试'));
    body.append(title,el('small','',`${historyTime(row.updatedAt||row.createdAt)} · ${historyProgress(row)}`));
    button.append(body,el('span','history-score',`${row.summary?.score??row.score} / ${row.summary?.maxScore??row.maxScore}`));
    remove.title='删除记录';remove.setAttribute('aria-label',`删除 ${historyTime(row.createdAt)} 的${row.mode==='exam'?'考试':''}历史记录`);
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
  if(!pane.historyRecords.length)list.append(el('p','list-empty','还没有历史记录。练习提交后或考试完成后，会在这里保存记录。'));
}
async function openHistoryList(pane){
  if(!pane||!collectionFeature(pane,'history'))return;if(!await allowDiscardEditor(pane))return;await flushPane(pane);
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
  await showHistoryQuestion(pane,qid,{historyEntry:entry,historyView,historyDraftMode:false});
}
async function showHistoryQuestion(pane,qid,{historyEntry=pane.historyEntry,historyView=pane.historyView,historyDraftMode=pane.historyDraftMode}={}){
  const entry=historyView.entry(qid);
  pane.loading=true;
  let candidateHost=null,candidatePlugin=null;
  try{
    const assets=await prepareAssets(entry.page);
    const historyQuestion={...entry,page:assets},next={...pane,view:'history',historyEntry,historyView,historyDraftMode,historyQuestion,historyQuestionId:qid,summaryShown:false};
    candidateHost=el('div','development-preview-candidate');pane.frameHost.append(candidateHost);
    candidatePlugin=mountExtension(candidateHost,assets,contextFor(next),{onLayout:(options,frame)=>setEditorLayout(pane,options,frame),onRequest:(method,args)=>pageRequest(pane.plugin===candidatePlugin?pane:next,method,args),onError:message=>{if(active()===pane&&pane.plugin===candidatePlugin)notice(message);}});
    await candidatePlugin.ready;
    if(pane.closed)throw new Error('题库页面已关闭');
    disposeEditorSession(pane);
    disposeScoreSummary(pane);
    pane.plugin?.destroy();pane.plugin=null;
    for(const child of [...pane.frameHost.children])if(child!==candidateHost)child.remove();candidateHost.classList.remove('development-preview-candidate');
    pane.view='history';pane.historyEntry=historyEntry;pane.historyView=historyView;pane.historyDraftMode=historyDraftMode;pane.editState=null;pane.historyQuestion=historyQuestion;pane.historyQuestionId=qid;pane.outlineItemId=null;
    const draft=draftViewActive(pane);
    pane.node.classList.remove('is-edit');pane.node.classList.toggle('is-draft',draft);pane.tools.hidden=!draft;pane.viewport.scrollTop=0;pane.viewport.scrollLeft=0;
    pane.whiteboard.setReadOnly(true);pane.whiteboard.load(entry.payload.draft);pane.whiteboard.setMode(draft?'draft':'practice');
    pane.plugin=candidatePlugin;syncPracticeCamera(pane);saveStatus('只读快照');renderOutline();
  }catch(error){if(pane.plugin!==candidatePlugin){candidatePlugin?.destroy();candidateHost?.remove();}throw error;
  }finally{pane.loading=false;updateChrome();}
}
function disposeEditorSession(pane){
  clearTimeout(pane.editorTimer);
  if(!pane.editorSession)return;
  pane.editorSession.destroy();pane.editorSession=null;pane.editState=null;pane.plugin=null;
}
function newEditorSession(){return createEditorSession();}
async function showEditorQuestion(pane,qid){
  if(!canEditCollection(pane)||pane.closed)return;
  if(pane.view==='edit'){
    if(pane.questionId===qid&&pane.plugin)return;
    await allowDiscardEditor(pane);
  }
  pane.node.inert=true;if(!pane.development||!pane.plugin?.hasError)await pane.plugin?.flush();
  const oldPlugin=pane.plugin,session=newEditorSession(),previous={view:pane.view,questionId:pane.questionId,editState:pane.editState,editorSession:pane.editorSession};
  let container,plugin,committed=false;
  pane.loading=true;updateChrome();
  try{
    const value=await request(questionPath(pane.kind,pane.id,qid)+'/editor');
    if(!value.editor)throw new Error('这个题型拓展尚未提供编辑器');
    value.editor=await prepareAssets(value.editor);
    container=el('div','editor-question-container');container.hidden=true;pane.frameHost.append(container);
    plugin=mountExtension(container,value.editor,{mode:'edit',question:value.question,...(pane.development?{development:pane.development}:{}),capabilities:{canEdit:true}},{
      onDirty:()=>{if(pane.plugin===plugin)renderEditorStatus(document,pane);},
      onLayout:(options,frame)=>setEditorLayout(pane,options,frame),
      onRequest:(method,args)=>['resource-get','sdk-editor'].includes(method)||pane.plugin===plugin?pageRequest({...pane,view:'edit',editState:value},method,args):Promise.resolve({ok:false,error:{code:'READ_ONLY',message:'当前编辑题卡未处于活动状态'}}),
      onError:message=>{if(active()===pane&&pane.plugin===plugin){if(pane.development)showPageFailure(pane,new Error(message),qid);else notice(message);}}
    });
    await plugin.ready;if(pane.closed)throw new Error('题库页面已关闭');
    // The replacement registers before the previous page is released. No
    // draft endpoint is read, written or used to revive an unfinished form.
    previous.editorSession?.destroy();if(!previous.editorSession)oldPlugin?.destroy();
    session.add(qid,{id:qid,value,plugin,container});
    pane.editorSession=session;pane.view='edit';pane.questionId=qid;pane.outlineItemId=null;pane.editState=value;pane.historyEntry=null;pane.historyView=null;pane.historyQuestion=null;pane.historyQuestionId=null;pane.plugin=plugin;committed=true;
    for(const child of [...pane.frameHost.children])if(child!==container)child.remove();
    container.hidden=false;pane.node.classList.remove('is-draft');pane.node.classList.add('is-edit');pane.tools.hidden=true;
    pane.whiteboard.setMode('practice');pane.viewport.scrollTop=0;pane.viewport.scrollLeft=0;
    syncPracticeCamera(pane);saveStatus('本题未修改');renderOutline();
  }catch(error){
    if(!committed){plugin?.destroy();container?.remove();Object.assign(pane,previous);pane.plugin=oldPlugin;}
    if(pane.development)showPageFailure(pane,error,qid);throw error;
  }finally{pane.loading=false;updateChrome();}
}

async function openEditor(pane){
  if(!canEditCollection(pane)||pane.view!=='practice')return;await flushPane(pane);
  if(!allowLeaveDevelopmentInput(pane))return;
  await showEditorQuestion(pane,pane.questionId);
}
async function saveEditor(pane){
  if(!canEditCollection(pane)||pane.view!=='edit'||pane.loading)return;
  pane.node.inert=true;
  const session=pane.editorSession;let confirmed=false;pane.loading=true;pendingWrites++;updateChrome();saveStatus('保存中…','saving');
  try{
    await pane.plugin.flush();
    const saved=await session.saveCurrent(async({id,entry,document})=>{
      const edit=entry.value;
      if(!edit.request||edit.request.sourceVersion!==edit.sourceVersion||edit.request.title!==document.title||JSON.stringify(edit.request.data)!==JSON.stringify(document.data))edit.request={requestId:makeRequestId(),revision:edit.revision,contentVersion:edit.contentVersion,sourceVersion:edit.sourceVersion,title:document.title,data:document.data};
      const body=JSON.stringify(edit.request),send=()=>request(questionPath(pane.kind,pane.id,id)+'/edit',{method:'POST',body});let value;
      try{value=await send();}catch(error){if(!(error instanceof TypeError))throw error;value=await send();}
      return value;
    },async({id,entry,document},value)=>{
      confirmed=true;
      questionsCache.deleteCollection(pane.key+':');questionsCache.set(questionCacheKey(pane,id),value.payload);
      pane.collection=value.collection;entry.value={...entry.value,question:{id,title:document.title,data:document.data},revision:value.payload.state.revision,contentVersion:value.payload.stamp.contentVersion,sourceVersion:value.sourceVersion};
      delete entry.value.request;entry.plugin.update({mode:'edit',question:entry.value.question,capabilities:{canEdit:true}});await entry.plugin.flush();
    });
    const collection=await request(collectionPath(pane.kind,pane.id)),payload=await loadQuestion(pane,pane.questionId);
    await showQuestion(pane,pane.questionId,{payload,collection});await refreshCatalog();notice(saved?'本题修改已保存。':'本题没有修改，已退出编辑。');
  }catch(error){
    saveStatus(confirmed?'本题已保存，读取失败':'本题修改未保存','error');
    const reason=error.status===409?'题目或练习状态已更新，当前编辑内容已保留。':error.message;
    error.message=confirmed?'本题已保存，但重新读取失败。'+reason:reason;throw error;
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
  for(const pane of panes){await allowDiscardEditor(pane);const saved=await flushPane(pane);if(!settings.enabled&&(saved===false||pane.retainedQuestions?.size)&&!confirm('关闭开发者模式会丢弃尚未保存的开发输入，是否继续？'))throw new Error('开发输入已保留，设置未更改');}
  if(settings.enabled)return;
  // Editing can be closed here only after its unsaved-change guard passed.
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
      pane.development=next.development||{};pane.developmentDescriptor=next;
      if(isCurrent()){pane.viewport.scrollTop=scroll;syncDevelopmentCatalog(pane,next);updateChrome();renderLibrary();}return isCurrent();
    }),onError:error=>{if(active()===pane)saveStatus(error.status===401?'预览连接已失效':'文件暂未就绪，保留上次预览','error');},
  });
  pane.developmentWatcher.setActive(active()===pane);
}
async function openCollection(kind,id){
  const key=`${kind}:${id}`;
  const previous=active(),previousInert=previous?.node.inert;
  const row=[...catalog.banks,...catalog.extensions].find(row=>row.id===id&&(row.kind||kind)===kind);
  const loading=collectionLoading.begin(row?.title||row?.name||collections.get(key)?.collection.title||'');
  let pane=null,committed=false;
  if(previous)previous.node.inert=true;
  try{
    if(previous?.key!==key)await allowDiscardEditor(previous);
    pendingLibraryKey=key;renderLibrary();
    await flushPane(previous);
    if(collections.has(key)){loading.setDetail('正在恢复题目…');await activateReady(key);return;}
    const [development,collection]=await Promise.all([
      kind.startsWith('development')?request(developmentPath({kind,id}),{timeoutMs:60000}):undefined,
      request(collectionPath(kind,id),{timeoutMs:60000}),
    ]);
    if(!collection.questions?.length)throw new Error('这个列表还没有题目');
    collection.states ||= {};
    const node=el('section','question-pane collection-candidate'),tools=el('div','qf-whiteboard-tool-row'),viewport=el('div','question-viewport'),stage=el('div','question-stage'),world=el('div','question-world'),frameHost=el('div','question-frame-wrapper');
    node.inert=true;
    tools.hidden=true;world.append(frameHost);stage.append(world);viewport.append(stage);node.append(tools,viewport);$('#panes').append(node);
    pane={key,kind,id,collection,node,tools,viewport,stage,world,frameHost,questionId:null,payload:null,plugin:null,whiteboard:null,writes:null,ink:createDraftBuffer(),draftMode:false,historyDraftMode:false,view:'practice',historyEntry:null,historyRecords:[],historyView:null,historyQuestion:null,historyQuestionId:null,editState:null,editorSession:null,loading:true,closed:false,inkTimer:null};
    if(kind==='exam')pane.exam=collection.exam;
    if(development){pane.development=development.development||{};pane.developmentDescriptor=development;}
    pane.writes=makeWriteQueue(pane);
    attachRuntime(pane);
    pane.sizeObserver=new ResizeObserver(()=>syncPracticeCamera(pane));pane.sizeObserver.observe(viewport);
    pane.worldObserver=new ResizeObserver(()=>syncPracticeCamera(pane));pane.worldObserver.observe(world);
    loading.setDetail('正在加载首题…');
    await showQuestion(pane,collection.questions[0].id);
    await suspendPane(previous);
    collections.set(key,pane);committed=true;node.classList.remove('collection-candidate');activate(key);
    if(pane.exam)examControls.observe(pane.exam);
    if(development)watchDevelopment(pane,development);
  }catch(error){
    if(pane&&!committed){pane.closed=true;clearTimeout(pane.inkTimer);pane.sizeObserver?.disconnect();pane.worldObserver?.disconnect();pane.plugin?.destroy();pane.whiteboard?.destroy();pane.node.remove();}
    throw error;
  }finally{
    if(previous&&!previous.closed)previous.node.inert=previousInert;
    if(committed)pane.node.inert=false;
    loading.finish();
    if(pendingLibraryKey===key){pendingLibraryKey=null;renderLibrary();}
  }
}
function activate(key){const selected=collections.get(key);if(selected){collections.delete(key);collections.set(key,selected);}activeKey=key;notice('');for(const pane of collections.values()){pane.node.hidden=pane.key!==key;pane.plugin?.setActive?.(pane.key===key);pane.developmentWatcher?.setActive(pane.key===key);}$('#welcome').hidden=!!selected;renderLibrary();renderOutline();updateChrome();renderRecovery();closeDrawers();const pane=active();saveStatus(pane?.writes.hasFailures?'仍有内容未保存':pane?.view==='history'?'只读快照':pane?.view==='edit'?'编辑中':pane?.payload&&pane.payload.state.status!=='unanswered'?practiceSaveLabel(pane):'',pane?.writes.hasFailures?'error':'');}
function attachRuntime(pane){if(pane.whiteboard)return;pane.whiteboard=mountWhiteboard(pane.viewport,{toolbarContainer:pane.tools,toolbarObstacles:()=>document.querySelectorAll('.question-arrow'),onChange:value=>enqueueInk(pane,value),onViewChange:camera=>{rememberDraftView(pane,camera);resizeStage(pane,camera);},onScroll:()=>rememberDraftScroll(pane),onFullscreen:()=>draftFullscreen.toggle()});pane.whiteboard.setFullscreenState(draftFullscreen.getState());pane.sizeObserver?.observe(pane.viewport);pane.worldObserver?.observe(pane.world);}
async function suspendPane(pane){
  if(!pane||pane.closed||!pane.whiteboard)return;
  const saved=await flushPane(pane);clearTimeout(pane.editorTimer);
  pane.savedScrollTop=pane.viewport.scrollTop;
  if(pane.development&&(saved===false||pane.retainedQuestions?.size)){pane.keepRuntime=true;pane.node.inert=true;return;}
  if(pane.view==='edit'){await allowDiscardEditor(pane);disposeEditorSession(pane);pane.view='practice';pane.node.classList.remove('is-edit');}
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
  const restoring=!pane.plugin&&!pane.needsRefresh;
  const [payload,restoredDescriptor]=await Promise.all([loadQuestion(pane,qid),restoring?request(collectionPath(pane.kind,pane.id)):null]);
  if(restoredDescriptor)descriptor=restoredDescriptor;
  if(pane.needsRefresh||!pane.plugin||!sameQuestionStamp(payload.stamp,pane.payload?.stamp)){
    if(!pane.needsRefresh&&!restoredDescriptor)descriptor=await request(collectionPath(pane.kind,pane.id));
    await showQuestion(pane,qid,{payload,collection:descriptor});
  }
}
function renderLibrary(){
  listMode=renderLibraryView({document,catalog,listMode,activeKey:pendingLibraryKey??activeKey,collapsedGroups:collapsedExtensionGroups,onNotice:notice,
    onOpen:(kind,id)=>transitionTo(()=>openCollection(kind,id)),
    onManage:(target,row,action)=>libraryManager.open(target,row,action)});
}
function renderOutline(){
  const pane=active();
  renderOutlineView({document,pane,
    onNavigate:(qid,itemId)=>transitionTo(async()=>{await navigateOutlineTarget(pane,qid,itemId,{navigateQuestion,renderOutline});closeDrawers();}),
    onSummary:()=>transitionTo(async()=>{await showScoreSummary(pane);closeDrawers();})});
}
const listeningPlayer=createListeningPlayer({document,request});
addEventListener('pagehide',()=>listeningPlayer.destroy(),{once:true});
function updateChrome(){
  listeningPlayer.setContext(active());
  if(typeof examControls!=='undefined')examControls.sync();
  draftFullscreen.sync();
  $('#document-group').hidden=true;
  const pane=active(),view=pane?.view,draft=draftViewActive(pane),draftButton=$('#draft-toggle');draftButton.hidden=!canViewDraft(pane);draftButton.disabled=!!pane?.loading;draftButton.setAttribute('aria-pressed',String(draft));draftButton.replaceChildren(el('span','','✎'),document.createTextNode(draft?(view==='history'?' 返回练习':' 返回作答'):' 草稿'));
  $('#history-open').hidden=!pane?.payload||pane?.exam?.status==='in-progress'||!collectionFeature(pane,'history')||!!pane.summaryShown&&!pane.scoreSummary?.historyId;$('#history-open').disabled=!!pane?.loading;
  $('#edit-open').hidden=!pane?.payload||!canEditCollection(pane)||view!=='practice';$('#edit-open').disabled=!!pane?.loading;
  $('#development-badge').hidden=true;
  for(const id of ['development-edit','development-return','development-publish-open'])$(`#${id}`).hidden=true;
  $('#mode-bar').hidden=!pane||['practice','summary'].includes(view);
  $('#history-choose').hidden=!collectionFeature(pane,'history')||!['history','history-deleted'].includes(view);$('#return-practice').hidden=!['history','history-deleted'].includes(view);
  for(const id of ['edit-cancel','edit-save']){$(`#${id}`).hidden=view!=='edit';$(`#${id}`).disabled=!!pane?.loading;}
  $('#mode-label').textContent=view==='history'?`只读历史 · ${pane.historyEntry.mode==='exam'?'考试 · ':''}${historyProgress(pane.historyEntry)} · ${historyTime(pane.historyEntry.createdAt)}`:view==='history-deleted'?'记录已删除，请选择其他记录或返回作答。':'';
  renderEditorStatus(document,pane);
  if(!pane){$('#document-title').textContent='选择一本题库';$('#progress-text').textContent='';$('#previous').disabled=true;$('#next').disabled=true;saveStatus('');return;}
  const rows=visibleQuestions(pane),index=navigationIndex(pane),count=rows.length;
  const libraryRow=(['extension','development'].includes(pane.kind)?catalog.extensions:catalog.banks).find(row=>row.id===pane.id&&(row.kind||(['extension','development'].includes(pane.kind)?'extension':'bank'))===pane.kind);
  $('#document-group').textContent=libraryRow?.group||'';$('#document-group').hidden=!libraryRow?.group;
  $('#document-title').textContent=view==='history'?pane.historyEntry.collectionTitle:libraryRow?.displayName||pane.collection.title;
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
  try{
    const [value,settings]=await Promise.all([libraryIndexClient().refresh(),request('/api/settings/development')]);
    if(!value)return;
    const returnToBanks=listMode==='extension'||catalog.developmentEnabled&&!active()||['extension','development','development-bank'].includes(active()?.kind);
    catalog.banks=value.banks;catalog.extensions=value.extensions;catalog.groups=value.groups||{banks:[],extensions:[]};catalog.canManage=value.canManage===true;catalog.developmentEnabled=(value.developmentEnabled??settings.enabled)===true;renderLibrary();
    if(!catalog.developmentEnabled&&returnToBanks){
      const previous=[...collections.values()].filter(pane=>pane.kind==='bank'&&catalog.banks.some(row=>row.id===pane.id&&!row.error)).at(-1),first=catalog.banks.find(row=>!row.error);
      if(previous||first)await openCollection(previous?.kind||first.kind||'bank',previous?.id||first.id);
      else{await suspendPane(active());activate(null);}
    }
  }
  catch(error){if(error.status===401){if(!$('#access-dialog').open)$('#access-dialog').showModal();}else throw error;}
  finally{button.classList.remove('is-loading');}
}
function libraryIndexClient(){
  return refreshCatalog.client ||= createLibraryIndexClient({
    request:(path,options)=>request(path,options),
    isVisible:()=>document.visibilityState==='visible',
    onIndex:value=>{
      catalog.banks=value.banks;catalog.extensions=value.extensions;catalog.groups=value.groups||{banks:[],extensions:[]};catalog.canManage=value.canManage===true;
      if(typeof value.developmentEnabled==='boolean')catalog.developmentEnabled=value.developmentEnabled;
      renderLibrary();
    },
    onError:error=>{if(error.status===401){if(!$('#access-dialog').open)$('#access-dialog').showModal();}else failure(error);},
  });
}
function switchList(kind){if(kind==='extension'&&!catalog.developmentEnabled)return;transitionTo(async()=>{await allowDiscardEditor(active());listMode=kind;renderLibrary();const open=[...collections.values()].filter(pane=>kind==='bank'?['bank','development-bank'].includes(pane.kind):['extension','development'].includes(pane.kind)).at(-1);const first=(kind==='bank'?catalog.banks:catalog.extensions).find(row=>!row.error);if(open||first)await openCollection(open?.kind||first.kind||kind,open?.id||first.id);});}

$('#show-banks').addEventListener('click',()=>switchList('bank'));$('#show-extensions').addEventListener('click',()=>switchList('extension'));
$('#refresh').addEventListener('click',()=>transitionTo(async()=>{for(const pane of collections.values())await allowDiscardEditor(pane);for(const pane of collections.values()){if(pane.view==='edit')await returnToPractice(pane);await flushPane(pane);}questionsCache.clear();pagesCache.clear();await refreshCatalog();for(const pane of collections.values())pane.needsRefresh=true;if(activeKey)await activateReady(activeKey);}));
const prepareLibraryChange=()=>transitionTo(async()=>{
    for(const pane of collections.values())await allowDiscardEditor(pane);
    for(const pane of collections.values())if(pane.view==='edit')await returnToPractice(pane);
    for(const pane of collections.values()){
      const inert=pane.node?.inert;
      try{if(await flushPane(pane)===false){
        const title=pane.collection?.title||pane.development?.name||pane.id||'开发题库',question=pane.payload?.question?.title||pane.questionId||'当前题目';
        throw new Error(`「${title}」中的「${question}」仍有未保存输入。请返回该题重试保存，完成后再修改目录。`);
      }}finally{if(pane.node)pane.node.inert=inert;}
    }
  });

async function applyLibraryChange(result,operation){
    const previous={banks:catalog.banks,extensions:catalog.extensions};
    if(result.catalog){Object.assign(catalog,result.catalog);renderLibrary();}
    else await refreshCatalog();
    let activeChanged=false,anyChanged=false;
    for(const pane of [...collections.values()]){
      const rows=['extension','development'].includes(pane.kind)?catalog.extensions:catalog.banks;
      const matches=row=>row.id===pane.id&&(row.kind||(['extension','development'].includes(pane.kind)?'extension':'bank'))===pane.kind&&!row.error;
      const row=rows.find(matches),oldRows=['extension','development'].includes(pane.kind)?previous.extensions:previous.banks,old=oldRows.find(matches);
      if(row){
        const retained=result.retainedCollections?.find(value=>value.kind===pane.kind&&value.id===pane.id);
        if(retained&&pane.collection&&!pane.needsRefresh&&!pane.summaryShown&&pane.view!=='summary'&&pane.collection.revision===retained.previousRevision){
          pane.collection={...pane.collection,title:retained.title,revision:retained.revision};
          continue;
        }
        if(!old?.contentRevision||row.contentRevision!==old.contentRevision||row.title!==old.title||row.name!==old.name||row.path!==old.path){pane.needsRefresh=true;anyChanged=true;activeChanged||=pane.key===activeKey;}
        continue;
      }
      anyChanged=true;pane.closed=true;pane.developmentWatcher?.destroy();clearTimeout(pane.inkTimer);clearTimeout(pane.editorTimer);pane.sizeObserver?.disconnect();pane.worldObserver?.disconnect();if(pane.retainedQuestions)disposeRetainedQuestions(pane);disposeEditorSession(pane);disposeScoreSummary(pane);pane.plugin?.destroy();pane.whiteboard?.destroy();pane.node.remove();collections.delete(pane.key);
    }
    if(anyChanged||!collections.has(activeKey)){questionsCache.clear();pagesCache.clear();}
    if(!collections.has(activeKey)){activeKey=null;const first=(listMode==='bank'?catalog.banks:catalog.extensions).find(row=>!row.error);if(first)await openCollection(first.kind||listMode,first.id);else activate(null);}
    else if(activeChanged)await activateReady(activeKey);
    updateChrome();
    notice(operation.action==='delete'?`已移入回收目录：${result.archivedTo}${operation.kind==='bank'?'；配套拓展文件已保留。':''}`:'目录已更新。');
}
const libraryManager=bindLibraryManagement({request,getContext:()=>({kind:listMode,catalog}),beforeChange:prepareLibraryChange,
  onExport:(row,target)=>target==='item'?libraryTransfer.exportBank(row,{throwOnError:true}):libraryTransfer.exportGroup(row,{throwOnError:true}),
  onChanged:(result,operation)=>transitionTo(()=>applyLibraryChange(result,operation))});
const libraryTransfer=bindLibraryTransfer({request,getContext:()=>({kind:listMode,catalog}),beforeChange:prepareLibraryChange,onMessage:notice,
  onImported:result=>transitionTo(async()=>{
    await refreshCatalog();questionsCache.clear();pagesCache.clear();
    if(!activeKey){const first=catalog.banks.find(row=>!row.error);if(first)await openCollection(first.kind||'bank',first.id);}
    notice(`已新增「${result.name||result.group}」${result.scope==='bank'?'到题库根目录':''}：${result.importedBanks} 本题库、${result.importedExtensions} 个拓展。已有题库与进度保留。`);
  })});
$('#library-new-group').addEventListener('click',()=>libraryManager.open('group',null,'create'));
bindSaveRecovery({document,active,transitionTo,loadQuestion,showQuestion,saveInk,notice,collectionFeature,renderOutline});
$('#draft-toggle').addEventListener('click',()=>transitionTo(()=>toggleDraftMode()));
const questionStepper=createQuestionStepper(take=>transitionTo(async()=>{
  const offset=take(),pane=active();if(!pane)return;
  const rows=visibleQuestions(pane),target=stepTarget(navigationIndex(pane),offset,rows.length,{summary:hasScoreSummary(pane)});
  if(target==null)return;
  if(target===rows.length)await showScoreSummary(pane);else await navigateQuestion(pane,rows[target].id);
}));
for(const [id,offset]of [['previous',-1],['next',1]])$(`#${id}`).addEventListener('click',()=>questionStepper.step(offset));
document.addEventListener('keydown',event=>{const pane=active();if(!pane||pane.richtextFrame)return;const offset=navigationShortcut(event,{document,draft:draftViewActive(pane)});if(!offset)return;event.preventDefault();questionStepper.step(offset);});
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
$('#edit-cancel').addEventListener('click',()=>transitionTo(()=>returnToPractice(active(),{discard:true})));
for(const key of ['library','outline'])$(`#${key}-toggle`).addEventListener('click',()=>toggleSidebar(key));
for(const media of [libraryDrawer,outlineDrawer])media.addEventListener('change',closeDrawers);
phoneLayout.addEventListener('change',()=>{for(const pane of collections.values())syncPracticeCamera(pane);});
$('#scrim').addEventListener('click',closeDrawers);syncSidebars();
bindLibraryResize({shell:$('.app-shell'),library:$('.library'),handle:$('#library-resize')});
const hubLogin=createHubLogin({request});
bindAiSettings({request,login:hubLogin});
bindUserCenter({request,login:hubLogin});
const examControls=bindExamMode({document,request,active,collectionPath,makeRequestId,onDeadline:()=>updateChrome(),flush:pane=>transitionTo(()=>flushPane(pane)),open:(kind,id)=>transitionTo(()=>openCollection(kind,id)),onError:failure,refresh:(pane,value)=>transitionTo(()=>refreshExam(pane,value))});
async function refreshExam(pane,exam){
  if(pane.closed)return;const changed=pane.exam?.status!==exam.status||JSON.stringify(pane.exam?.gradingErrors||[])!==JSON.stringify(exam.gradingErrors||[]);pane.exam=exam;
  if(changed){
    await pane.writes.settled();
    questionsCache.deleteCollection(`${pane.key}:`);pane.writes.clear();pane.ink.clear();clearTimeout(pane.inkTimer);pane.inkTimer=null;
    if(exam.gradingErrors?.length){pane.plugin?.update(contextFor(pane));notice('交卷已锁定，部分题目评分失败。请重试评分。');}
    else if(active()===pane&&pane.view==='practice')await showQuestion(pane,pane.questionId,{payload:await loadQuestion(pane,pane.questionId,{fresh:true}),collection:await request(collectionPath('exam',pane.id))});
    else pane.needsRefresh=true;
  }
  if(active()===pane)updateChrome();
}
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
window.addEventListener('beforeunload',event=>{if(shouldWarnBeforeUnload(collections.values(),pendingWrites)){event.preventDefault();event.returnValue='';}});
window.addEventListener('pagehide',()=>refreshCatalog.client?.stop());
document.addEventListener('visibilitychange',()=>{refreshCatalog.client?.visibilityChanged();if(document.visibilityState==='hidden'){const pane=active();if(pane&&!pane.loading&&pane.view==='practice'){pane.whiteboard.flush();saveInk(pane).catch(()=>{});}}});
async function start(){await refreshCatalog();const imported=takeImportedBank(catalog),first=imported||catalog.banks.find(row=>!row.error);if(first&&(!collections.size||imported))await transitionTo(()=>openCollection(first.kind||'bank',first.id));if(imported)notice(`已导入并打开「${imported.title}」。`);}
start().catch(failure);
