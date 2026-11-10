// Discarding failed input must not call the extension's save barrier: its
// onFlush hook may be precisely the operation that cannot be completed.
export function bindSaveRecovery({document,active,transitionTo,loadQuestion,showQuestion,saveInk,notice,collectionFeature,renderOutline=()=>{},confirm=globalThis.confirm,cancel=clearTimeout}){
  const factory=document.defaultView.QuizForgeUI?.mountSaveRecovery;
  if(!factory)throw Error('缺少界面构建文件，请运行 npm --prefix core run build:ui。');
  const container=document.querySelector('#save-recovery');let disposed=false,busy=false;
  const widget=factory({container,run:command=>{if(disposed||container.hidden||busy)return;(command==='retry'?retry():loadSaved())?.catch(()=>{});}});
  function update(pane=active()){
    if(disposed)return;const failed=pane?.writes?.failures||[];
    const message=failed.some(value=>value.error.code==='CONTENT_CONFLICT')?'题目内容已更改，当前输入仍保留。请读取已保存内容后重新作答。':failed.some(value=>value.error.status===409)?'保存状态发生冲突。当前输入仍保留，可重试，或读取已保存的内容。':pane?.development?'仍有内容未保存，当前输入保留。可以切题后返回重试。':'仍有内容未保存，切题已暂停。当前输入仍保留。';
    widget.update({message,busy,hidden:!failed.length});
  }
  function capture(pane){const qid=pane?.questionId,view=pane?.view;return ()=>!disposed&&!pane?.closed&&active()===pane&&pane.questionId===qid&&pane.view===view;}
  async function perform(work){busy=true;update();try{return await work();}finally{busy=false;update();}}
  async function retry(){
    const pane=active();if(disposed||busy||!pane||pane.closed)return;const current=capture(pane),plugin=pane.plugin;
    return perform(()=>transitionTo(async()=>{
      if(!current()||pane.plugin!==plugin)return;
      pane.node.inert=true;
      await pane.plugin?.flush();if(!current())return;pane.whiteboard?.flush();
      await pane.writes.settled();if(!current())return;await saveInk(pane);
      for(const failure of pane.writes.failures){
        if(!current())return;
        await pane.writes.enqueue(failure.questionId,failure.action,failure.data,{contentVersion:failure.contentVersion});
      }
      if(current()&&!pane.writes.hasFailures){pane.answerPreviews?.clear();pane.answerStateSnapshots?.clear();renderOutline();notice('');}
    }));
  }
  async function loadSaved(){
    const pane=active();
    if(disposed||busy||!pane||pane.closed||!confirm('读取已保存内容会放弃当前未保存的答案和笔迹，是否继续？'))return;const current=capture(pane),originalPlugin=pane.plugin;
    return perform(()=>transitionTo(async()=>{
      if(!current()||pane.plugin!==originalPlugin)return;
      const plugin=pane.plugin,qid=pane.questionId;
      pane.node.inert=true;pane.recovering=true;
      cancel(pane.inkTimer);pane.inkTimer=null;
      plugin?.setActive?.(false);
      try{
        // Drain writes already accepted by the host before reading their result.
        // The old frame remains available until the replacement is ready.
        await pane.writes.settled();if(!current())return;
        const payload=await loadQuestion(pane,qid,{fresh:true});
        if(!current()||pane.plugin!==originalPlugin)return;
        await showQuestion(pane,qid,{payload});if(!current())return;
        pane.ink.clear();pane.writes.clear();pane.answerPreviews?.clear();pane.answerStateSnapshots?.clear();renderOutline();
        notice(collectionFeature(pane,'history')?'已读取已保存的内容。':'已读取当前会话状态。');
      }finally{
        pane.recovering=false;
        if(!disposed&&!pane.closed&&pane.plugin===plugin)plugin?.setActive?.(active()===pane);
      }
    }));
  }
  update();
  return {retry,loadSaved,update,destroy(){if(disposed)return;disposed=true;widget.destroy();}};
}
