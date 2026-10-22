// Keep each reported state paired with the immutable answer snapshot it describes.
function createAnswerSaver({context,answer,statuses,onError,onBusy,onSaved=()=>{}}) {
  const clone = value => JSON.parse(JSON.stringify(value));
  let version=0,saved=0,pending=null,timer=null,queue=Promise.resolve(),disposed=false,generation=0;
  const waiters=[];
  function unwrap(reply) {if (!reply?.ok) throw Object.assign(new Error(reply?.error?.message||'保存失败，输入已保留'),{code:reply?.error?.code});return reply.data;}
  function report(snapshot) {
    // Invoked during input, independently of older in-flight answer saves.
    const job=QF.page.reportAnswerState(statuses(snapshot)[0]).then(reply=>unwrap(reply).stateId);
    job.catch(()=>{});return job;
  }
  function settle(error) {
    for(let i=waiters.length-1;i>=0;i--)if(error||waiters[i].version<=saved){const item=waiters.splice(i,1)[0];error?item.reject(error):item.resolve();}
  }
  function enqueue(operation) {
    const token=generation;
    const job=queue.catch(()=>{}).then(async()=>{
      if(disposed||token!==generation)return;
      onBusy(true);try{const value=await operation();onSaved();return value;}catch(error){onError(error);settle(error);throw error;}finally{if(!disposed)onBusy(false);}
    });queue=job;job.catch(()=>{});return job;
  }
  function saveDraft() {
    clearTimeout(timer);timer=null;
    return enqueue(async()=>{
      while(pending&&saved<version&&context().capabilities.canSave&&context().status!=='submitted') {
        const entry=pending;let stateId;
        try{entry.report??=report(entry.snapshot);stateId=await entry.report;}catch(error){entry.report=null;throw error;}
        try{unwrap(await QF.save({purpose:'draft',data:{answer:entry.snapshot},answerStateId:stateId}));}
        catch(error){
          if(error.code!=='INVALID_ANSWER_STATE')throw error;
          // Never re-report an obsolete answer after more recent input.
          if(pending!==entry)continue;
          entry.report=report(entry.snapshot);stateId=await entry.report;
          unwrap(await QF.save({purpose:'draft',data:{answer:entry.snapshot},answerStateId:stateId}));
        }
        saved=entry.version;if(pending===entry)pending=null;settle();
      }
    });
  }
  return {
    changed() {
      if(disposed||!context().capabilities.canSave||context().status==='submitted')return Promise.resolve();
      const snapshot=clone(answer());pending={snapshot,version:++version,report:report(snapshot)};
      const job=new Promise((resolve,reject)=>waiters.push({version,resolve,reject}));job.catch(()=>{});
      clearTimeout(timer);timer=setTimeout(()=>{void saveDraft();},250);return job;
    },
    async flush() {
      clearTimeout(timer);timer=null;
      // After submission drafts are never saved, so a leftover one must not block 重做 or other actions.
      if(context().status==='submitted'||!context().capabilities.canSave){pending=null;saved=version;settle();await queue;return;}
      if(pending)await saveDraft();await queue;if(saved<version)throw new Error('答案尚未保存，请重试');
    },
    async submit(){await this.flush();return enqueue(async()=>unwrap(await QF.save({purpose:'submit',data:{answer:clone(answer())}})));},
    review(value){return enqueue(async()=>unwrap(await QF.save({purpose:'review',data:{review:value}})));},
    retry(){return enqueue(async()=>unwrap(await QF.requestAction({action:'retry'})));},
    reset(){generation++;clearTimeout(timer);timer=null;version=saved=0;pending=null;settle();},
    dispose(){disposed=true;clearTimeout(timer);timer=null;settle(new Error('作答页面已释放'));}
  };
}

(function () {
  'use strict';
  const $ = id => document.getElementById(id), content = QF.content, copy = value => JSON.parse(JSON.stringify(value));
  const components = new Map(), views = new Map(), targets = new Map(), answers = new Map(), tasks = new Map(), reviewDrafts = new Map(), reviewTimers = new Map();
  let context, key = null, disposed = false, epoch = 0, busy = false, pollTimer = null, polling = false;
  const areaEmpty = area => !area || !(area.text?.trim() || area.strokes?.length || area.images?.length);
  const areaId = part => 'response-' + part.id;
  const resize = () => {if (!disposed) QF.ui.resize();};
  function error(value) {if (!disposed) {$('error').hidden = false;$('error').textContent = value.message || String(value);resize();}}
  function locked() {return context.status === 'submitted' || context.mode === 'history' || context.capabilities.canSave !== true;}
  function readAnswer() {return {responses:Object.fromEntries([...answers].map(([id,doc]) => [id,copy(doc)]))};}
  function statuses(snapshot) {return [{status:context.question.data.parts.some(part => !areaEmpty(snapshot.responses[part.id])) ? 'draft' : 'unanswered'}];}
  const saver = createAnswerSaver({context:() => context,answer:readAnswer,statuses,onError:error,onSaved:()=>{$('error').hidden=true;},onBusy:value => {busy = value;controls();}});
  function render(name,host,doc) {views.get(name)?.destroy();const view = content.render(host,doc);views.set(name,view);const token = epoch;view.ready.then(() => {if (!disposed && token === epoch) resize();}).catch(error);}
  function controls() {
    if (!context) return;
    $('submit').hidden = context.status === 'submitted' || context.capabilities.canSubmit !== true;
    $('submit').disabled = busy || ![...answers.values()].some(doc => !areaEmpty(doc));
    $('retry').hidden = context.status !== 'submitted' || context.capabilities.canRetry !== true;$('retry').disabled = busy;
    for (const part of context.question.data.parts) updateGrade(part.id);
  }
  function changedAnswer(id,doc) {
    if (disposed || locked()) return Promise.resolve();
    if (JSON.stringify(answers.get(id)) === JSON.stringify(doc)) return Promise.resolve();
    answers.set(id,copy(doc));const saved = saver.changed();controls();resize();return saved;
  }
  function emptyArea(part) {return {type:'qf-answer-area',formatVersion:1,id:areaId(part),width:760,height:part.answerHeight??480,strokes:[]};}
  function restoreArea(part) {
    const saved = context.answer?.responses?.[part.id];
    const doc = saved ? {...copy(saved),height:Math.max(saved.height,part.answerHeight??480)} : emptyArea(part);
    answers.set(part.id,copy(doc));components.get(part.id).setDocument(doc);
  }
  function updateGrade(id) {
    const target = targets.get(id), part = context?.question.data.parts.find(part => part.id === id);if (!target || !part) return;
    const result = context.result?.parts?.[id], task = tasks.get(id), running = task && ['queued','running'].includes(task.status);
    target.result.hidden = context.status !== 'submitted';
    target.value.textContent = Number.isFinite(result?.score) ? `${result.score} / ${part.maxScore} 分` : '待评分';
    target.slider.value = String(reviewDrafts.has(id) ? reviewDrafts.get(id) : result?.score || 0);
    target.slider.disabled = context.capabilities.canReview !== true || areaEmpty(answers.get(id));
    target.ai.hidden = context.capabilities.canAiGrade !== true || areaEmpty(answers.get(id));
    target.ai.disabled = Boolean(running);target.ai.textContent = running ? '评分中…' : task?.status === 'failed' ? '重试 AI 评分' : task ? 'AI 重新评分' : 'AI 评分';
    target.feedback.hidden = !result?.feedback && task?.status !== 'failed';target.feedback.textContent = task?.status === 'failed' ? task.error?.message || 'AI 评分失败，请重试' : result?.feedback || '';
    resize();
  }
  async function saveReview(id) {
    clearTimeout(reviewTimers.get(id));reviewTimers.delete(id);
    if (!reviewDrafts.has(id) || context.capabilities.canReview !== true) return;
    const score = reviewDrafts.get(id);await saver.review({score,targetId:id});
    if (reviewDrafts.get(id) === score) reviewDrafts.delete(id);updateGrade(id);
  }
  function manual(event) {
    if (!event.target.matches('input[type=range]') || context.capabilities.canReview !== true) return;
    const id = event.target.dataset.id;reviewDrafts.set(id,Number(event.target.value));clearTimeout(reviewTimers.get(id));reviewTimers.set(id,setTimeout(() => saveReview(id).catch(error),250));
  }
  function unwrap(reply) {if (!reply?.ok) throw Object.assign(new Error(reply?.error?.message || 'AI 评分未完成'),{code:reply?.error?.code});return reply.data;}
  function stopPoll() {clearTimeout(pollTimer);pollTimer = null;}
  function scheduleTasks() {stopPoll();if (!disposed && context.status === 'submitted' && context.capabilities.canAiGrade === true) pollTimer = setTimeout(() => {pollTimer = null;refreshTasks();},200);}
  async function refreshTasks() {
    if (disposed || polling || context.status !== 'submitted' || context.capabilities.canAiGrade !== true) return;
    polling = true;const token = epoch;
    try {
      for (const part of context.question.data.parts) {
        if (disposed || token !== epoch) return;
        const reply = unwrap(await QF.ai.getTask({targetId:part.id}));
        if (disposed || token !== epoch) return;
        tasks.set(part.id,reply.task || null);updateGrade(part.id);
      }
    } catch (value) {if (value.code === 'READ_ONLY') scheduleTasks();else error(value);}
    finally {
      polling = false;
      if (!disposed && token === epoch && [...tasks.values()].some(task => task && ['queued','running'].includes(task.status))) {stopPoll();pollTimer = setTimeout(() => {pollTimer = null;refreshTasks();},1200);}
    }
  }
  async function gradeAi(id) {
    if (context.capabilities.canAiGrade !== true || areaEmpty(answers.get(id)) || ['queued','running'].includes(tasks.get(id)?.status)) return;
    const previous = tasks.get(id);tasks.set(id,{status:'queued'});updateGrade(id);
    try {
      const task = unwrap(previous?.status === 'failed' ? await QF.ai.retry({taskId:previous.taskId}) : await QF.ai.grade({targetId:id,force:!!previous}));
      if (disposed) return;tasks.set(id,task);updateGrade(id);await refreshTasks();
    } catch (value) {tasks.set(id,previous);updateGrade(id);throw value;}
  }
  function clickAi(event) {const button = event.target.closest('button[data-ai]');if (button) gradeAi(button.dataset.ai).catch(error);}
  async function flush() {
    // Let the component finish uploads/ink first, then drain this extension's answer queue.
    // Start the queue so a component's onChange Promise cannot deadlock its flush.
    const pending = Promise.all([...components.values()].map(component => component.flush()));pending.catch(()=>{});
    await saver.flush();await pending;await saver.flush();
    for (const id of [...reviewDrafts.keys()]) await saveReview(id);
  }
  async function submit() {if (busy || context.capabilities.canSubmit !== true) return;await flush();await saver.submit();}
  async function retry() {if (busy || context.capabilities.canRetry !== true) return;await flush();await saver.retry();}
  const submitHandler = () => submit().catch(error), retryHandler = () => retry().catch(error);
  $('parts').addEventListener('input',manual);$('parts').addEventListener('click',clickAi);$('submit').addEventListener('click',submitHandler);$('retry').addEventListener('click',retryHandler);
  QF.page.register({
    async onLoad(next) {
      const nextKey = next.mode + ':' + next.question.id, wasSubmitted = context?.status === 'submitted';
      const rebuild = key !== nextKey || !context || wasSubmitted && next.status !== 'submitted';context = next;key = nextKey;
      if (!rebuild) {if (next.status === 'submitted') {for (const part of next.question.data.parts) {restoreArea(part);if (!wasSubmitted) render('assessment-' + part.id,targets.get(part.id).assessment,part.answerAndExplanation);}scheduleTasks();}controls();return;}
      epoch++;stopPoll();saver.reset();components.forEach(component => component.destroy());components.clear();views.forEach(view => view.destroy());views.clear();targets.clear();answers.clear();tasks.clear();reviewDrafts.clear();reviewTimers.forEach(clearTimeout);reviewTimers.clear();$('error').hidden = true;
      const version = QF.answerAreas?.version?.split('.').map(Number);
      if (!version || version[0] !== 1 || version[1] < 4 || version[1] === 4 && version[2] < 1) throw new Error('请更新宿主：此拓展需要答题区组件1.4.1或以上');
      const data = next.question.data, multiple = data.parts.length > 1;
      $('total-score').textContent = `${data.parts.reduce((sum,part) => sum + part.maxScore,0)} 分`;$('material').hidden = !data.material || content.isEmpty(data.material);if (!$('material').hidden) render('material',$('material'),data.material);else $('material').replaceChildren();$('parts').replaceChildren();
      data.parts.forEach((part,index) => {
        const section = document.createElement('section');section.className = 'part';section.dataset.id = part.id;
        if (multiple) {const heading = document.createElement('div');heading.className = 'part-header';const number = document.createElement('span');number.className = 'part-number';number.textContent = `（${index + 1}）`;const score = document.createElement('span');score.className = 'question-score';score.textContent = `${part.maxScore} 分`;heading.append(number,score);section.append(heading);}
        const stem = document.createElement('div');stem.className = 'stem';const answer = document.createElement('div');answer.className = 'answer-area-host';answer.tabIndex = -1;answer.dataset.id = part.id;answer.setAttribute('aria-label',multiple ? `第${index + 1}问作答` : '作答');
        const result = document.createElement('section');result.className = 'result';result.hidden = true;const caption = document.createElement('div');caption.className = 'section-label';caption.textContent = '答案与解析';const assessment = document.createElement('div');const grading = document.createElement('div');grading.className = 'grading';
        const slider = document.createElement('input');slider.type = 'range';slider.min = '0';slider.max = String(part.maxScore);slider.step = '.5';slider.className = 'grade-slider';slider.dataset.id = part.id;slider.setAttribute('aria-label',multiple ? `第${index + 1}问人工评分` : '人工评分');
        const value = document.createElement('span');value.className = 'grade-value';value.setAttribute('aria-live','polite');const ai = document.createElement('button');ai.type = 'button';ai.className = 'ai-button';ai.dataset.ai = part.id;ai.setAttribute('aria-label',multiple ? `第${index + 1}问 AI 评分` : 'AI 评分');const feedback = document.createElement('p');feedback.className = 'ai-feedback';
        grading.append(slider,value,ai);result.append(caption,assessment,grading,feedback);section.append(stem,answer,result);$('parts').append(section);targets.set(part.id,{section,answer,result,assessment,slider,value,ai,feedback});render('stem-' + part.id,stem,part.stem);
        const component = QF.answerAreas.mount(answer,{id:areaId(part),label:multiple ? `第${index+1}问作答` : '作答',width:760,height:part.answerHeight??480,allowText:true,allowImages:true,sharedInk:true,onChange:doc => changedAnswer(part.id,doc)});components.set(part.id,component);restoreArea(part);
        if (next.status === 'submitted') render('assessment-' + part.id,assessment,part.answerAndExplanation);
      });
      controls();await Promise.all([...views.values()].map(view => view.ready));resize();if (next.status === 'submitted') scheduleTasks();
    },
    onFlush:flush,
    async onOutlineNavigate(id) {const target = targets.get(id);if (!target) return false;await Promise.all([...views.values()].map(view => view.ready));target.section.scrollIntoView({block:'center',behavior:'auto'});target.answer.focus({preventScroll:true});return true;},
    onDispose() {disposed = true;epoch++;stopPoll();saver.dispose();reviewTimers.forEach(clearTimeout);reviewTimers.clear();components.forEach(component => component.destroy());components.clear();views.forEach(view => view.destroy());views.clear();$('parts').removeEventListener('input',manual);$('parts').removeEventListener('click',clickAi);$('submit').removeEventListener('click',submitHandler);$('retry').removeEventListener('click',retryHandler);}
  }).catch(error);
})();
