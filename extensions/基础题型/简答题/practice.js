function createAnswerSaver({context,answer,statuses,onError,onBusy}) {
  let version = 0, saved = 0, timer = null, disposed = false, queue = Promise.resolve(), reports = Promise.resolve(), lastError = null;
  const clone = value => JSON.parse(JSON.stringify(value));
  function unwrap(reply) {if (!reply?.ok) throw Object.assign(new Error(reply?.error?.message || '操作未完成'),{code:reply?.error?.code});return reply.data;}
  function report(snapshot, patches) {
    const job = reports.catch(() => {}).then(async () => {
      let stateId;
      for (const status of patches || statuses(snapshot)) {
        if (disposed) return;
        stateId = unwrap(await QF.page.reportAnswerState(status)).stateId;
      }
      return stateId;
    });
    reports = job;job.catch(onError);return job;
  }
  function enqueue(operation) {
    const job = queue.catch(() => {}).then(async () => {
      if (disposed) return;
      onBusy(true);
      try {const result = await operation();lastError = null;return result;}
      catch (error) {lastError = error;onError(error);throw error;}
      finally {if (!disposed) onBusy(false);}
    });
    queue = job;job.catch(() => {});return job;
  }
  function saveDraft() {
    clearTimeout(timer);timer = null;
    return enqueue(async () => {
      if (version === saved || !context().capabilities.canSave || context().status === 'submitted') return;
      const capturedVersion = version, snapshot = clone(answer());
      const stateId = await report(snapshot);
      if (disposed) return;
      unwrap(await QF.save({purpose:'draft',data:{answer:snapshot},answerStateId:stateId}));
      saved = capturedVersion;
    });
  }
  return {
    changed() {
      if (disposed || context().capabilities.canSave !== true) return;
      version++;
      clearTimeout(timer);timer = setTimeout(() => saveDraft(),250);
    },
    reportProgress(patches) {if (!disposed && context().capabilities.canSave && context().status !== 'submitted') return report(clone(answer()),patches);},
    async flush() {
      clearTimeout(timer);timer = null;
      // After submission drafts are never saved, so a leftover draft or old error must not block 重做.
      if (context().status === 'submitted' || !context().capabilities.canSave) {saved = version;await queue.catch(() => {});lastError = null;return;}
      if (version !== saved && context().capabilities.canSave && context().status !== 'submitted') saveDraft();
      await queue;await reports;
      if (lastError) throw lastError;
      if (version !== saved && context().capabilities.canSave && context().status !== 'submitted') {await saveDraft();await queue;}
    },
    async submit() {await this.flush();return enqueue(async () => unwrap(await QF.save({purpose:'submit',data:{answer:clone(answer())}})));},
    async review(value) {return enqueue(async () => unwrap(await QF.save({purpose:'review',data:{review:value}})));},
    async retry() {await queue;return enqueue(async () => unwrap(await QF.requestAction({action:'retry'})));},
    reset() {clearTimeout(timer);timer = null;version = 0;saved = 0;lastError = null;},
    dispose() {disposed = true;clearTimeout(timer);timer = null;}
  };
}

(function () {
  'use strict';
  const $ = id => document.getElementById(id), content = QF.content, copy = value => JSON.parse(JSON.stringify(value));
  const views = new Map(), targets = new Map(), answers = new Map(), tasks = new Map(), reviewDrafts = new Map(), reviewTimers = new Map();
  let context, key = null, active = null, editor = null, switching = Promise.resolve(), disposed = false, epoch = 0, busy = false, acting = false, pollTimer = null, polling = false, reportedStatus = null;
  const resize = () => {if (!disposed) QF.ui.resize();};
  function error(value) {if (!disposed) {$('error').hidden = false;$('error').textContent = value.message || String(value);resize();}}
  function locked() {return context.status === 'submitted' || context.mode === 'history' || context.capabilities.canSave !== true;}
  function readAnswer() {return {responses:Object.fromEntries([...answers].map(([id,doc]) => [id,copy(doc)]))};}
  function statuses(snapshot) {return [{status:context.question.data.parts.some(part => !content.isEmpty(snapshot.responses[part.id])) ? 'draft' : 'unanswered'}];}
  const saver = createAnswerSaver({context:() => context,answer:readAnswer,statuses,onError:error,onBusy:value => {busy = value;controls();}});
  function render(name,host,doc) {views.get(name)?.destroy();const view = content.render(host,doc);views.set(name,view);const token = epoch;view.ready.then(() => {if (!disposed && token === epoch) resize();}).catch(error);}
  function controls() {
    if (!context) return;
    $('submit').hidden = context.status === 'submitted' || context.capabilities.canSubmit !== true;
    // Background draft saves no longer disable the buttons; only a submit or 重做 in progress does.
    $('submit').disabled = acting || ![...answers.values()].some(doc => !content.isEmpty(doc));$('submit').textContent = acting && context.status !== 'submitted' ? '提交中…' : '提交';
    $('retry').hidden = context.status !== 'submitted' || context.capabilities.canRetry !== true;$('retry').disabled = acting;
    for (const part of context.question.data.parts) updateGrade(part.id);
  }
  function changedAnswer(id,doc) {
    if (JSON.stringify(answers.get(id)) === JSON.stringify(doc)) return;
    answers.set(id,copy(doc));saver.changed();
    const status = statuses(readAnswer())[0].status;
    if (reportedStatus !== status) {reportedStatus = status;saver.reportProgress([{status}]);}
    controls();resize();
  }
  function previewAnswer(id) {
    const host = targets.get(id)?.answer;if (!host) return;
    views.get('answer-' + id)?.destroy();views.delete('answer-' + id);
    host.classList.remove('is-editing');host.classList.toggle('readonly',locked());host.tabIndex = locked() ? -1 : 0;host.setAttribute('role',locked() ? 'region' : 'button');
    if (content.isEmpty(answers.get(id))) {host.replaceChildren();const hint = document.createElement('span');hint.className = 'answer-placeholder';hint.textContent = locked() ? '未作答' : '点击作答';host.append(hint);}
    else render('answer-' + id,host,answers.get(id));
    resize();
  }
  async function closeEditor() {
    if (!editor) return;
    await editor.flush();changedAnswer(active,editor.getDocument());const previous = active;editor.destroy();editor = null;active = null;previewAnswer(previous);
  }
  async function activate(id) {
    if (disposed || locked() || active === id || !targets.has(id)) return;
    await closeEditor();if (disposed || locked()) return;
    const host = targets.get(id).answer;views.get('answer-' + id)?.destroy();views.delete('answer-' + id);host.classList.add('is-editing');host.removeAttribute('role');host.tabIndex = -1;active = id;
    const candidate = content.createEditor(host,{doc:answers.get(id) || copy(content.EMPTY_DOCUMENT),placeholder:'',onChange(doc) {if (!disposed && active === id && !locked()) changedAnswer(id,doc);}});
    editor = candidate;await candidate.ready;if (disposed || editor !== candidate) {candidate.destroy();return;}candidate.focus();resize();
  }
  function schedule(operation) {switching = switching.catch(() => {}).then(operation);switching.catch(error);}
  function requestEdit(event) {
    if (event.type === 'keydown' && !['Enter',' '].includes(event.key)) return;
    const host = event.target.closest('.answer-field');if (!host || host.classList.contains('is-editing') || locked()) return;
    if (event.type === 'keydown') event.preventDefault();schedule(() => activate(host.dataset.id));
  }
  function updateGrade(id) {
    const target = targets.get(id), part = context?.question.data.parts.find(part => part.id === id);if (!target || !part) return;
    const result = context.result?.parts?.[id], task = tasks.get(id), running = task && ['queued','running'].includes(task.status);
    target.result.hidden = context.status !== 'submitted';
    target.value.textContent = Number.isFinite(result?.score) ? `${result.score} / ${part.maxScore} 分` : '待评分';
    target.slider.value = String(reviewDrafts.has(id) ? reviewDrafts.get(id) : result?.score || 0);
    target.slider.disabled = context.capabilities.canReview !== true || content.isEmpty(answers.get(id));
    target.ai.hidden = context.capabilities.canAiGrade !== true || content.isEmpty(answers.get(id));
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
  function unwrap(reply) {if (!reply?.ok) throw new Error(reply?.error?.message || 'AI 评分未完成');return reply.data;}
  function stopPoll() {clearTimeout(pollTimer);pollTimer = null;}
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
    } catch (value) {error(value);}
    finally {
      polling = false;
      if (!disposed && token === epoch && [...tasks.values()].some(task => task && ['queued','running'].includes(task.status))) {stopPoll();pollTimer = setTimeout(() => {pollTimer = null;refreshTasks();},1200);}
    }
  }
  async function gradeAi(id) {
    if (context.capabilities.canAiGrade !== true || content.isEmpty(answers.get(id)) || ['queued','running'].includes(tasks.get(id)?.status)) return;
    const previous = tasks.get(id);tasks.set(id,{status:'queued'});updateGrade(id);
    try {
      const task = unwrap(previous?.status === 'failed' ? await QF.ai.retry({taskId:previous.taskId}) : await QF.ai.grade({targetId:id,force:!!previous}));
      if (disposed) return;tasks.set(id,task);updateGrade(id);await refreshTasks();
    } catch (value) {tasks.set(id,previous);updateGrade(id);throw value;}
  }
  function clickAi(event) {const button = event.target.closest('button[data-ai]');if (button) gradeAi(button.dataset.ai).catch(error);}
  async function flush() {
    await switching;await editor?.flush();if (editor && active && !locked()) changedAnswer(active,editor.getDocument());
    await saver.flush();for (const id of [...reviewDrafts.keys()]) await saveReview(id);
  }
  // Clicking waits for the editor and any running draft save first, and repeated clicks are ignored.
  async function act(task) {if (acting) return;acting = true;controls();try {await task();} finally {acting = false;controls();}}
  async function submit() {if (acting || context.capabilities.canSubmit !== true) return;await act(async () => {await switching;await closeEditor();await saver.submit();});}
  async function retry() {if (acting || context.capabilities.canRetry !== true) return;await act(async () => {await flush();await saver.retry();});}
  const submitHandler = () => submit().catch(error), retryHandler = () => retry().catch(error);
  $('parts').addEventListener('click',requestEdit);$('parts').addEventListener('keydown',requestEdit);$('parts').addEventListener('input',manual);$('parts').addEventListener('click',clickAi);$('submit').addEventListener('click',submitHandler);$('retry').addEventListener('click',retryHandler);
  QF.page.register({
    async onLoad(next) {
      const nextKey = next.mode + ':' + next.question.id, wasSubmitted = context?.status === 'submitted';
      const rebuild = key !== nextKey || !context || wasSubmitted !== (next.status === 'submitted');context = next;key = nextKey;
      if (!rebuild) {controls();if (next.status === 'submitted') refreshTasks();return;}
      epoch++;stopPoll();saver.reset();editor?.destroy();editor = null;active = null;views.forEach(view => view.destroy());views.clear();targets.clear();answers.clear();tasks.clear();reviewDrafts.clear();reviewTimers.forEach(clearTimeout);reviewTimers.clear();reportedStatus = null;$('error').hidden = true;
      const data = next.question.data, multiple = data.parts.length > 1;
      $('total-score').textContent = `${data.parts.reduce((sum,part) => sum + part.maxScore,0)} 分`;$('material').hidden = !data.material || content.isEmpty(data.material);if (!$('material').hidden) render('material',$('material'),data.material);else $('material').replaceChildren();$('parts').replaceChildren();
      data.parts.forEach((part,index) => {
        const section = document.createElement('section');section.className = 'part';section.dataset.id = part.id;
        if (multiple) {const heading = document.createElement('div');heading.className = 'part-header';const number = document.createElement('span');number.className = 'part-number';number.textContent = `（${index + 1}）`;const score = document.createElement('span');score.className = 'question-score';score.textContent = `${part.maxScore} 分`;heading.append(number,score);section.append(heading);}
        const stem = document.createElement('div');stem.className = 'stem';const answer = document.createElement('div');answer.className = 'answer-field';answer.dataset.id = part.id;answer.setAttribute('aria-label',multiple ? `第${index + 1}问作答` : '作答');
        const result = document.createElement('section');result.className = 'result';result.hidden = true;const caption = document.createElement('div');caption.className = 'section-label';caption.textContent = '答案与解析';const assessment = document.createElement('div');const grading = document.createElement('div');grading.className = 'grading';
        const slider = document.createElement('input');slider.type = 'range';slider.min = '0';slider.max = String(part.maxScore);slider.step = '.5';slider.className = 'grade-slider';slider.dataset.id = part.id;slider.setAttribute('aria-label',multiple ? `第${index + 1}问人工评分` : '人工评分');
        const value = document.createElement('span');value.className = 'grade-value';value.setAttribute('aria-live','polite');const ai = document.createElement('button');ai.type = 'button';ai.className = 'ai-button';ai.dataset.ai = part.id;ai.setAttribute('aria-label',multiple ? `第${index + 1}问 AI 评分` : 'AI 评分');const feedback = document.createElement('p');feedback.className = 'ai-feedback';
        grading.append(slider,value,ai);result.append(caption,assessment,grading,feedback);section.append(stem,answer,result);$('parts').append(section);targets.set(part.id,{section,answer,result,assessment,slider,value,ai,feedback});render('stem-' + part.id,stem,part.stem);
        if (next.answer?.responses?.[part.id]) answers.set(part.id,copy(next.answer.responses[part.id]));previewAnswer(part.id);
        if (next.status === 'submitted') render('assessment-' + part.id,assessment,part.answerAndExplanation);
      });
      reportedStatus = statuses(readAnswer())[0].status;controls();await Promise.all([...views.values()].map(view => view.ready));resize();if (next.status === 'submitted') refreshTasks();
    },
    onFlush:flush,
    async onOutlineNavigate(id) {const target = targets.get(id);if (!target) return false;await switching;await Promise.all([...views.values()].map(view => view.ready));target.section.scrollIntoView({block:'center',behavior:'auto'});target.answer.focus({preventScroll:true});return true;},
    onDispose() {disposed = true;epoch++;stopPoll();saver.dispose();reviewTimers.forEach(clearTimeout);reviewTimers.clear();editor?.destroy();editor = null;views.forEach(view => view.destroy());views.clear();$('parts').removeEventListener('click',requestEdit);$('parts').removeEventListener('keydown',requestEdit);$('parts').removeEventListener('input',manual);$('parts').removeEventListener('click',clickAi);$('submit').removeEventListener('click',submitHandler);$('retry').removeEventListener('click',retryHandler);}
  }).catch(error);
})();
