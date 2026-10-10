(function(){'use strict';
  const $=id=>document.getElementById(id),content=QF.content,empty={type:'doc',content:[{type:'paragraph'}]};
  let context=null,questionId=null,answer=empty,editor=null,views=[],busy=false,version=0,savedVersion=0,timer=null,saveChain=Promise.resolve(),disposed=false;
  let aiTask=null,aiBusy=false,aiEpoch=0,pollTimer=null,aiError='',pollFailed=false,currentLoaded=false,resultStamp='';
  let reviewVersion=0,savedReviewVersion=0,reviewScore=0,reviewTimer=null,reviewFlight=null,reviewChain=Promise.resolve(),reviewError='',reviewEpoch=0;
  const copy=value=>JSON.parse(JSON.stringify(value)),caps=()=>context?.capabilities||{},locked=()=>context?.status==='submitted'||context?.mode==='history';
  const resize=()=>{if(!disposed)QF.ui?.resize();};
  const aiAllowed=()=>!disposed&&context?.mode!=='history'&&context?.status==='submitted'&&caps().canAiGrade===true&&!!QF.ai;
  const pendingAi=()=>aiTask&&['queued','running','succeeded'].includes(aiTask.status);
  const currentCandidate=()=>aiTask&&['succeeded','confirmed'].includes(aiTask.status)&&aiTask.candidate&&Number.isFinite(aiTask.candidate.score)&&aiTask.candidate.score>=0&&aiTask.candidate.score<=context.question.data.maxScore&&Number.isInteger(aiTask.candidate.score*2)?aiTask.candidate:null;
  const reviewAllowed=()=>!disposed&&context?.mode!=='history'&&context?.status==='submitted'&&caps().canReview===true;
  const reviewChanged=()=>reviewVersion>savedReviewVersion;
  function notice(text,error=false){if(disposed)return;$('save-notice').textContent=text;$('save-notice').classList.toggle('is-error',error);resize();}
  function controls(){
    if(disposed)return;const submitted=context?.status==='submitted';
    $('submit-button').hidden=submitted||context?.mode==='history';$('submit-button').disabled=busy||!context||!caps().canSubmit||content.isEmpty(answer);
    $('retry-button').hidden=!submitted||context?.mode==='history';$('retry-button').disabled=busy||!!reviewFlight||!caps().canRetry;
    $('review-score').disabled=busy||!reviewAllowed();$('review-retry').hidden=!reviewError;$('review-retry').disabled=busy||!!reviewFlight||!reviewAllowed();
    $('progress-label').textContent=submitted?(context.result?.gradingStatus==='pending'?'已提交 · 待评分':'已提交 · 已评分'):content.isEmpty(answer)?'待作答':'已作答 · 尚未提交';renderAi();resize();
  }
  function clearViews(){for(const view of views)view.destroy();views=[];}
  function staticView(host,doc){const view=content.render(host,doc);views.push(view);view.ready?.then(resize);return view;}
  async function saveDraft(){clearTimeout(timer);timer=null;if(disposed||locked()||version<=savedVersion||!caps().canSave)return saveChain;
    const current=version,data={formatVersion:1,document:copy(answer)};
    const next=saveChain.catch(()=>{}).then(async()=>{const reply=await QF.save({purpose:'draft',data:{answer:data}});if(!reply?.ok)throw new Error(reply?.error?.message||'答案保存失败。');savedVersion=Math.max(savedVersion,current);if(current===version)notice('答案已保存。');});saveChain=next;next.catch(error=>notice(`${error.message} 当前答案仍保留，请重试。`,true));return next;
  }
  async function flush(){clearTimeout(timer);timer=null;clearTimeout(reviewTimer);reviewTimer=null;await editor?.flush();if(editor)answer=editor.getDocument();await saveDraft();await saveChain;await saveReview();await reviewChain;}
  function changed(doc){answer=copy(doc);version++;controls();notice('正在保存答案…');clearTimeout(timer);timer=setTimeout(()=>saveDraft().catch(()=>{}),180);}
  function resetReview(){clearTimeout(reviewTimer);reviewTimer=null;reviewEpoch++;reviewVersion=0;savedReviewVersion=0;reviewScore=0;reviewError='';reviewFlight=null;reviewChain=Promise.resolve();}
  function saveReview(){
    clearTimeout(reviewTimer);reviewTimer=null;if(reviewFlight)return reviewFlight;if(!reviewChanged())return reviewChain;
    if(!reviewAllowed())return Promise.reject(new Error('当前评分尚未保存，暂时无法提交评分。'));
    const epoch=reviewEpoch,qid=questionId;
    const next=(async()=>{
      while(!disposed&&epoch===reviewEpoch&&qid===questionId&&reviewChanged()){
        const current=reviewVersion,score=reviewScore;
        const reply=await QF.save({purpose:'review',data:{review:{score}}});
        if(disposed||epoch!==reviewEpoch||qid!==questionId)return;
        if(!reply?.ok)throw new Error(reply?.error?.message||'评分保存失败。');
        savedReviewVersion=Math.max(savedReviewVersion,current);reviewError='';
        if(!reviewChanged())notice('评分已自动保存。');
      }
    })();
    reviewFlight=next;reviewChain=next;controls();
    next.catch(error=>{if(!disposed&&epoch===reviewEpoch&&qid===questionId){reviewError=error.message;notice(`${error.message} 当前分数仍保留，请重试保存。`,true);}}).finally(()=>{if(reviewFlight===next){reviewFlight=null;controls();}});
    return next;
  }
  function changedReview(){if(!reviewAllowed())return;reviewScore=Number($('review-score').value);reviewVersion++;reviewError='';$('review-value').textContent=`${reviewScore} 分`;notice('正在保存评分…');controls();clearTimeout(reviewTimer);reviewTimer=setTimeout(()=>saveReview().catch(()=>{}),180);}
  function cancelPoll(){clearTimeout(pollTimer);pollTimer=null;aiEpoch++;}
  function resetAi(){cancelPoll();aiTask=null;aiBusy=false;aiError='';pollFailed=false;currentLoaded=false;}
  function renderAi(){
    const hidden=!context||context.status!=='submitted'||context.mode==='history';$('ai-panel').hidden=hidden;if(hidden)return;
    const candidate=currentCandidate(),disabled=!aiAllowed()||busy||aiBusy||!!reviewFlight||reviewChanged();
    $('ai-status').textContent=aiBusy?'正在处理…':({queued:'排队中',running:'评分中',succeeded:'评分已生成',failed:'评分失败',superseded:'评分已失效',confirmed:'评分已保存'})[aiTask?.status]||'';
    $('ai-help').textContent=!caps().canReview?'本轮已结束，已保存评分可在历史记录中查看。':!caps().canAiGrade?'AI 评分暂不可用，可以对照参考答案手动评分。':'评分完成后自动保存，可继续调整下方分数。';
    $('ai-candidate').hidden=!candidate;$('ai-score').textContent=candidate?`AI 得分 ${candidate.score} / ${context.question.data.maxScore} 分`:'';$('ai-feedback').textContent=candidate&&typeof candidate.feedback==='string'?candidate.feedback:'';
    const failure=aiError||(aiTask?.status==='failed'?aiTask.error?.message||'评分未完成，请重试。':'');$('ai-error').textContent=failure;$('ai-error').hidden=!failure;
    $('ai-grade').hidden=!!aiTask&&aiTask.status!=='superseded';$('ai-grade').disabled=disabled;
    $('ai-retry').hidden=!(aiTask?.status==='failed'||pollFailed);$('ai-retry').disabled=disabled;
    $('ai-retry').textContent=pollFailed?'检查进度':'重试评分';$('ai-regrade').hidden=!aiTask||aiTask.status==='superseded';$('ai-regrade').disabled=disabled;
  }
  function applyTask(value){
    if(!value||typeof value.taskId!=='string'||!['queued','running','succeeded','failed','superseded','confirmed'].includes(value.status))throw new Error('AI 任务状态无效，请重新检查进度。');
    aiTask=copy(value);aiError='';pollFailed=false;
    renderAi();resize();schedulePoll();
  }
  function replyTask(reply){if(!reply?.ok)throw new Error(reply?.error?.message||'AI 评分操作失败。');return reply.data;}
  function schedulePoll(){clearTimeout(pollTimer);pollTimer=null;if(disposed||context?.mode==='history'||context?.status!=='submitted'||!pendingAi())return;
    const epoch=aiEpoch,id=aiTask.taskId,qid=questionId;pollTimer=setTimeout(()=>{pollTimer=null;pollTask(epoch,id,qid);},1500);
  }
  async function pollTask(epoch,id,qid){
    try{const reply=await QF.ai.getTask({taskId:id});if(disposed||epoch!==aiEpoch||qid!==questionId||aiTask?.taskId!==id)return;applyTask(replyTask(reply));}
    catch(error){if(disposed||epoch!==aiEpoch||qid!==questionId)return;aiError=`查询评分进度失败：${error.message}`;pollFailed=true;renderAi();resize();}
  }
  async function loadCurrent(){
    if(currentLoaded||!aiAllowed())return;currentLoaded=true;const epoch=aiEpoch,qid=questionId;
    try{const reply=await QF.ai.getTask({});if(disposed||epoch!==aiEpoch||qid!==questionId)return;const value=replyTask(reply);cancelPoll();
      if(value?.task)applyTask(value.task);else {aiTask=null;aiError='';pollFailed=false;renderAi();resize();}
    }catch(error){if(disposed||epoch!==aiEpoch||qid!==questionId)return;aiError=`读取评分进度失败：${error.message}`;pollFailed=!!aiTask&&pendingAi();renderAi();resize();}
  }
  async function startAi(action){
    if(!aiAllowed()||busy||aiBusy||reviewChanged()||reviewFlight)return;cancelPoll();const epoch=aiEpoch,qid=questionId,id=aiTask?.taskId;aiBusy=true;aiError='';pollFailed=false;renderAi();
    if(action==='regrade'&&aiTask){aiTask={taskId:id,status:'superseded'};renderAi();}
    try{const reply=action==='check'&&id?await QF.ai.getTask({taskId:id}):action==='retry'&&id?await QF.ai.retry({taskId:id}):await QF.ai.grade({force:action==='regrade'});
      if(disposed||epoch!==aiEpoch||qid!==questionId)return;applyTask(replyTask(reply));
    }catch(error){if(!disposed&&epoch===aiEpoch&&qid===questionId){aiError=error.message;pollFailed=!!aiTask&&pendingAi();}}
    finally{if(!disposed&&epoch===aiEpoch&&qid===questionId){aiBusy=false;renderAi();resize();}}
  }
  function result(data){const submitted=context.status==='submitted';$('result-panel').hidden=!submitted;if(!submitted)return;
    $('result-score').textContent=context.result?.gradingStatus==='pending'?`待评分 / ${data.maxScore} 分`:`${context.result?.score??0} / ${context.result?.maxScore??data.maxScore} 分`;
    staticView($('reference-answer'),data.referenceAnswer||empty);staticView($('rubric'),data.rubric||empty);
    const feedback=context.result?.feedback;$('result-feedback').textContent=typeof feedback==='string'?feedback:'';$('result-feedback').hidden=typeof feedback!=='string'||!feedback;
    $('review-panel').hidden=context.mode==='history'||caps().canReview===false;$('review-score').max=String(data.maxScore);
    if(!reviewChanged()){reviewScore=context.result?.score??0;$('review-score').value=String(reviewScore);$('review-value').textContent=`${$('review-score').value} 分`;}
  }
  async function load(next){if(disposed||!next?.question)return;const changedQuestion=questionId!==next.question.id,reset=context?.status==='submitted'&&next.status!=='submitted',wasLocked=locked(),nextResultStamp=JSON.stringify(next.result),resultChanged=nextResultStamp!==resultStamp;context=next;resultStamp=nextResultStamp;
    if(changedQuestion||reset){resetAi();resetReview();questionId=next.question.id;version=0;savedVersion=0;answer=copy(next.answer?.document||empty);}
    else if(locked()||version<=savedVersion)answer=copy(next.answer?.document||answer);
    if(resultChanged&&next.aiTask===null&&(aiTask||aiBusy)){cancelPoll();aiTask=null;aiBusy=false;aiError='';pollFailed=false;currentLoaded=false;}
    if(next.mode==='history'||next.status!=='submitted'){cancelPoll();aiTask=null;}
    else if(next.aiTask?.taskId&&next.aiTask.status){if(aiTask?.taskId!==next.aiTask.taskId)cancelPoll();applyTask(next.aiTask);}
    else if(next.aiTask?.taskId&&!aiTask){aiTask={taskId:next.aiTask.taskId,status:'queued'};schedulePoll();}
    $('score-hint').textContent=`满分 ${next.question.data.maxScore} 分`;
    if(changedQuestion||reset||wasLocked!==locked()||!editor&&!locked()){
      editor?.destroy();editor=null;clearViews();staticView($('stem'),next.question.data.stem);
      if(locked())staticView($('answer-host'),answer);
      else {const candidate=content.createEditor($('answer-host'),{doc:answer,onChange:changed,placeholder:'写下你的答案，可插入图片…'});editor=candidate;await candidate.ready;if(disposed||editor!==candidate){candidate.destroy();return;}}
    }else if(locked()){clearViews();staticView($('stem'),next.question.data.stem);staticView($('answer-host'),answer);}
    result(next.question.data);controls();
    if(reviewChanged())notice(reviewError?`${reviewError} 当前分数仍保留，请重试保存。`:'正在保存评分…',!!reviewError);
    else notice(next.mode==='history'?(next.status==='submitted'?'历史记录 · 只读。':'历史记录 · 未作答。'):locked()?(caps().canReview===false?'本轮已完成，评分已保存。':'答案已提交，调整评分后自动保存。'):'输入后自动保存。');
    // Looking up the current task is read-only and never starts a model request.
    loadCurrent();
  }
  async function submit(){if(busy||locked()||!caps().canSubmit||content.isEmpty(answer))return;busy=true;controls();try{await flush();const reply=await QF.save({purpose:'submit',data:{answer:{formatVersion:1,document:copy(answer)}}});if(!reply?.ok)throw new Error(reply?.error?.message||'提交失败。');notice('答案已提交，调整评分后自动保存。');}catch(error){notice(`${error.message} 当前答案仍保留。`,true);}finally{busy=false;controls();}}
  $('submit-button').addEventListener('click',submit);$('review-retry').addEventListener('click',()=>saveReview().catch(()=>{}));
  $('review-score').addEventListener('input',changedReview);
  $('ai-grade').addEventListener('click',()=>startAi('grade'));$('ai-regrade').addEventListener('click',()=>startAi('regrade'));$('ai-retry').addEventListener('click',()=>startAi(pollFailed?'check':'retry'));
  $('retry-button').addEventListener('click',async()=>{if(busy||!caps().canRetry)return;busy=true;controls();try{await flush();const reply=await QF.requestAction({action:'retry'});if(!reply?.ok)throw new Error(reply?.error?.message||'重新作答失败。');}catch(error){notice(error.message,true);}finally{busy=false;controls();}});
  QF.page.register({onLoad:load,onFlush:flush,onDispose(){disposed=true;cancelPoll();clearTimeout(timer);clearTimeout(reviewTimer);editor?.destroy();editor=null;clearViews();}});
})();
