import {renderSaveStatus} from '../shell/workspace-view.js';
import {historyProgress} from '../history/history-view.js';
import {collectionFeature} from '../practice/practice-context.js';

const bindings=new WeakMap(),departed=new WeakSet();
export function bindEditorUi({document,getPane,onCommand=async()=>{}}){
  bindings.get(document)?.destroy();departed.delete(document);
  const container=document.querySelector('#mode-bar'),dialog=document.querySelector('#editor-leave-dialog');
  const factory=document.defaultView.QuizForgeUI?.mountEditorUi;
  if(!factory)throw Error('缺少界面构建文件，请运行 npm --prefix core run build:ui。');
  let binding,disposed=false,signature=[],scope={};
  const widget=factory({container,dialog,noticeContainer:document.querySelector('#editor-leave-root'),isCurrent:()=>!disposed&&bindings.get(document)===binding&&container.isConnected});
  function update(pane){
    if(disposed)return;
    const keys=[pane,pane?.view,pane?.questionId,pane?.editorSession,pane?.historyEntry];
    if(keys.some((key,index)=>key!==signature[index])){scope={};signature=keys;}
    const current=()=>!disposed&&!pane?.closed&&(!getPane||getPane()===pane)&&keys.every((key,index)=>key===[pane,pane?.view,pane?.questionId,pane?.editorSession,pane?.historyEntry][index]);
    const view=pane?.view,editing=view==='edit',history=['history','history-deleted'].includes(view);
    const label=editing?`编辑当前题目 · ${pane.editorSession?.isDirty?'本题修改未保存':'本题未修改'}`:view==='history'?`只读历史 · ${pane.historyEntry.mode==='exam'?'考试 · ':''}${historyProgress(pane.historyEntry)} · ${new Date(pane.historyEntry.createdAt).toLocaleString('zh-CN',{hour12:false})}`:view==='history-deleted'?'记录已删除，请选择其他记录或返回作答。':'';
    widget.update({scope,model:{hidden:!pane||['practice','summary'].includes(view),editing,history,choose:collectionFeature(pane,'history'),busy:!!pane?.loading,label},isCurrent:current,run:(command,isCurrent)=>onCommand(command,pane,()=>current()&&isCurrent())});
  }
  binding={update,showNotice:error=>{if(!disposed)widget.notice(String(error.message||error));},destroy(){if(disposed)return;disposed=true;widget.destroy();if(bindings.get(document)===binding){bindings.delete(document);departed.add(document);}}};
  bindings.set(document,binding);return binding;
}
function editorUi(document){return bindings.get(document)||(departed.has(document)?null:bindEditorUi({document}));}

export async function checkEditorExit(pane,{discard=false,confirmDiscard=()=>false}={}){
  if(pane?.view!=='edit')return true;
  let changed;
  try{
    await pane.plugin?.flush();
    if(!pane.editorSession)throw new Error('当前编辑页面尚未就绪');
    changed=await pane.editorSession.hasChanges();
  }catch(error){
    if(!discard)throw Object.assign(new Error(`无法确认当前题目的编辑状态：${error.message}。请先保存，或取消编辑后重试。`),{code:'UNSAVED_EDITOR_CHANGES'});
    changed=true;
  }
  if(!changed)return true;
  if(discard)return confirmDiscard('是否放弃当前题目尚未保存的修改？');
  throw Object.assign(new Error('当前题目有修改未保存。请先保存或取消当前题目的修改，再离开编辑。'),{code:'UNSAVED_EDITOR_CHANGES'});
}

export function renderEditorStatus(document,pane,setStatus){
  if(departed.has(document))return;
  editorUi(document)?.update(pane);
  if(pane?.view!=='edit')return;
  const $=selector=>document.querySelector(selector),dirty=!!pane.editorSession?.isDirty;
  const status=$('#save-state');
  if(!pane.loading&&!status.classList.contains('saving')&&!status.classList.contains('error')){const text=dirty?'本题修改未保存':'本题未修改';if(setStatus)setStatus(text);else renderSaveStatus(document,{text,type:''});}
}

export function bindEditorLeaveNotice(document){
  const binding=editorUi(document);return error=>binding?.showNotice(error);
}

export function shouldWarnBeforeUnload(panes,pendingWrites){
  return !!pendingWrites||[...panes].some(pane=>pane.view!=='edit'&&(pane.ink?.pending||pane.writes?.hasFailures||pane.plugin?.hasUnsavedInput||pane.retainedQuestions?.size));
}
