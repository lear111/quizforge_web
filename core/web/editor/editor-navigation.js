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
  if(pane?.view!=='edit')return;
  const $=selector=>document.querySelector(selector),dirty=!!pane.editorSession?.isDirty;
  $('#edit-save').textContent='保存本题';$('#edit-cancel').textContent='取消编辑';
  $('#mode-label').textContent=`编辑当前题目 · ${dirty?'本题修改未保存':'本题未修改'}`;
  const status=$('#save-state');
  if(!pane.loading&&!status.classList.contains('saving')&&!status.classList.contains('error')){const text=dirty?'本题修改未保存':'本题未修改';if(setStatus)setStatus(text);else status.textContent=text;}
}

export function bindEditorLeaveNotice(document){
  const dialog=document.querySelector('#editor-leave-dialog'),message=document.querySelector('#editor-leave-message');
  document.querySelector('#editor-leave-return').addEventListener('click',()=>dialog.close());
  return error=>{message.textContent=error.message;if(!dialog.open)dialog.showModal();};
}

export function shouldWarnBeforeUnload(panes,pendingWrites){
  return !!pendingWrites||[...panes].some(pane=>pane.view!=='edit'&&(pane.ink?.pending||pane.writes?.hasFailures||pane.plugin?.hasUnsavedInput||pane.retainedQuestions?.size));
}
