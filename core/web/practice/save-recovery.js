// Discarding failed input must not call the extension's save barrier: its
// onFlush hook may be precisely the operation that cannot be completed.
export function bindSaveRecovery({document,active,transitionTo,loadQuestion,showQuestion,saveInk,notice,collectionFeature,renderOutline=()=>{},confirm=globalThis.confirm,cancel=clearTimeout}){
  async function retry(){
    const pane=active();if(!pane||pane.closed)return;
    return transitionTo(async()=>{
      if(pane.closed)return;
      pane.node.inert=true;
      await pane.plugin?.flush();pane.whiteboard?.flush();
      await pane.writes.settled();await saveInk(pane);
      for(const failure of pane.writes.failures){
        await pane.writes.enqueue(failure.questionId,failure.action,failure.data,{contentVersion:failure.contentVersion});
      }
      if(!pane.writes.hasFailures){pane.answerPreviews?.clear();pane.answerStateSnapshots?.clear();renderOutline();notice('');}
    });
  }
  async function loadSaved(){
    const pane=active();
    if(!pane||pane.closed||!confirm('读取已保存内容会放弃当前未保存的答案和笔迹，是否继续？'))return;
    return transitionTo(async()=>{
      if(pane.closed)return;
      const plugin=pane.plugin,qid=pane.questionId;
      pane.node.inert=true;pane.recovering=true;
      cancel(pane.inkTimer);pane.inkTimer=null;
      plugin?.setActive?.(false);
      try{
        // Drain writes already accepted by the host before reading their result.
        // The old frame remains available until the replacement is ready.
        await pane.writes.settled();
        const payload=await loadQuestion(pane,qid,{fresh:true});
        if(pane.closed)return;
        await showQuestion(pane,qid,{payload});
        pane.ink.clear();pane.writes.clear();pane.answerPreviews?.clear();pane.answerStateSnapshots?.clear();renderOutline();
        notice(collectionFeature(pane,'history')?'已读取已保存的内容。':'已读取当前会话状态。');
      }finally{
        pane.recovering=false;
        if(!pane.closed&&pane.plugin===plugin)plugin?.setActive?.(active()===pane);
      }
    });
  }
  const retryButton=document.querySelector('#retry-save'),loadButton=document.querySelector('#load-saved');
  // transitionTo owns reporting rejected commands, as with other host actions.
  const onRetry=()=>{retry()?.catch(()=>{});},onLoad=()=>{loadSaved()?.catch(()=>{});};
  retryButton.addEventListener('click',onRetry);loadButton.addEventListener('click',onLoad);
  return {retry,loadSaved,destroy(){retryButton.removeEventListener('click',onRetry);loadButton.removeEventListener('click',onLoad);}};
}
