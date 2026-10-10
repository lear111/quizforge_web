(function(){'use strict';
  const $=id=>document.getElementById(id),content=QF.content,empty={type:'doc',content:[{type:'paragraph'}]};
  let context=null,questionId=null,answer=empty,editor=null,views=[],busy=false,version=0,savedVersion=0,timer=null,saveChain=Promise.resolve(),disposed=false;
  const copy=value=>JSON.parse(JSON.stringify(value)),caps=()=>context?.capabilities||{},locked=()=>context?.status==='submitted'||context?.mode==='history';
  const resize=()=>QF.ui?.resize();
  function notice(text,error=false){if(disposed)return;$('save-notice').textContent=text;$('save-notice').classList.toggle('is-error',error);resize();}
  function controls(){const submitted=context?.status==='submitted';$('submit-button').hidden=submitted||context?.mode==='history';$('submit-button').disabled=busy||!context||!caps().canSubmit||content.isEmpty(answer);$('retry-button').hidden=!submitted||context?.mode==='history';$('retry-button').disabled=busy||!caps().canRetry;$('review-confirm').disabled=busy||caps().canReview===false;$('review-score').disabled=busy||caps().canReview===false;$('progress-label').textContent=submitted?(context.result?.gradingStatus==='pending'?'已提交 · 待评分':'已提交 · 已评分'):content.isEmpty(answer)?'待作答':'已作答 · 尚未提交';resize();}
  function clearViews(){for(const view of views)view.destroy();views=[];}
  function staticView(host,doc){const view=content.render(host,doc);views.push(view);view.ready?.then(resize);return view;}
  async function saveDraft(){clearTimeout(timer);timer=null;if(disposed||locked()||version<=savedVersion||!caps().canSave)return saveChain;
    const current=version,data={formatVersion:1,document:copy(answer)};
    const next=saveChain.catch(()=>{}).then(async()=>{const reply=await QF.save({purpose:'draft',data:{answer:data}});if(!reply?.ok)throw new Error(reply?.error?.message||'答案保存失败。');savedVersion=Math.max(savedVersion,current);if(current===version)notice('答案已保存。');});saveChain=next;next.catch(error=>notice(`${error.message} 当前答案仍保留，请重试。`,true));return next;
  }
  async function flush(){clearTimeout(timer);timer=null;await editor?.flush();if(editor)answer=editor.getDocument();await saveDraft();await saveChain;}
  function changed(doc){answer=copy(doc);version++;controls();notice('正在保存答案…');clearTimeout(timer);timer=setTimeout(()=>saveDraft().catch(()=>{}),180);}
  function result(data){const submitted=context.status==='submitted';$('result-panel').hidden=!submitted;
    if(!submitted)return;$('result-score').textContent=context.result?.gradingStatus==='pending'?`待评分 / ${data.maxScore} 分`:`${context.result?.score??0} / ${context.result?.maxScore??data.maxScore} 分`;
    staticView($('reference-answer'),data.referenceAnswer||empty);staticView($('rubric'),data.rubric||empty);
    $('review-panel').hidden=context.mode==='history'||caps().canReview===false;$('review-score').max=String(data.maxScore);$('review-score').value=String(context.result?.score??0);$('review-value').textContent=`${$('review-score').value} 分`;
  }
  async function load(next){if(disposed||!next?.question)return;const changedQuestion=questionId!==next.question.id,reset=context?.status==='submitted'&&next.status!=='submitted',wasLocked=locked();context=next;
    if(changedQuestion||reset){questionId=next.question.id;version=0;savedVersion=0;answer=copy(next.answer?.document||empty);}
    else if(locked()||version<=savedVersion)answer=copy(next.answer?.document||answer);
    $('question-title').textContent=next.question.title;$('score-hint').textContent=`满分 ${next.question.data.maxScore} 分`;
    // Saved-state replies must not recreate the editor or steal its caret.
    if(changedQuestion||reset||wasLocked!==locked()||!editor&& !locked()){
      editor?.destroy();editor=null;clearViews();staticView($('stem'),next.question.data.stem);
      if(locked())staticView($('answer-host'),answer);
      else {const candidate=content.createEditor($('answer-host'),{doc:answer,onChange:changed,placeholder:'写下你的答案，可插入图片…'});editor=candidate;await candidate.ready;if(disposed||editor!==candidate){candidate.destroy();return;}}
    }else if(locked()){clearViews();staticView($('stem'),next.question.data.stem);staticView($('answer-host'),answer);}
    result(next.question.data);controls();notice(next.mode==='history'?(next.status==='submitted'?'历史记录 · 只读。':'历史记录 · 未作答。'):locked()?(caps().canReview===false?'本轮已完成，评分已保存。':'答案已提交，可对照参考答案评分。'):'输入后自动保存。');
  }
  async function submit(){if(busy||locked()||!caps().canSubmit||content.isEmpty(answer))return;busy=true;controls();try{await flush();const reply=await QF.save({purpose:'submit',data:{answer:{formatVersion:1,document:copy(answer)}}});if(!reply?.ok)throw new Error(reply?.error?.message||'提交失败。');notice('答案已提交，请对照参考答案评分。');}catch(error){notice(`${error.message} 当前答案仍保留。`,true);}finally{busy=false;controls();}}
  async function review(){if(busy||context?.mode==='history'||context?.status!=='submitted'||caps().canReview===false)return;busy=true;controls();try{const score=Number($('review-score').value),reply=await QF.save({purpose:'review',data:{review:{score}}});if(!reply?.ok)throw new Error(reply?.error?.message||'评分保存失败。');notice('评分已确认，结束本轮前可以调整。');}catch(error){notice(error.message,true);}finally{busy=false;controls();}}
  $('submit-button').addEventListener('click',submit);$('review-confirm').addEventListener('click',review);$('review-score').addEventListener('input',()=>{$('review-value').textContent=`${$('review-score').value} 分`;});
  $('retry-button').addEventListener('click',async()=>{if(busy||!caps().canRetry)return;busy=true;controls();try{const reply=await QF.requestAction({action:'retry'});if(!reply?.ok)throw new Error(reply?.error?.message||'重新作答失败。');}catch(error){notice(error.message,true);}finally{busy=false;controls();}});
  QF.page.register({onLoad:load,onFlush:flush,onDispose(){disposed=true;clearTimeout(timer);editor?.destroy();editor=null;clearViews();}});
})();
