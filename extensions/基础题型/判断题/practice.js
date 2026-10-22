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
  const KIND = 'true-false', $ = id => document.getElementById(id), content = QF.content;
  // acting: a submit or 重做 the user started; background draft saves no longer disable the buttons.
  let context, selected = new Set(), disposed = false, busy = false, acting = false, key = null, epoch = 0;
  const views = new Map();
  const resize = () => {if (!disposed) QF.ui.resize();};
  function error(value) {if (!disposed) {$('error').hidden = false;$('error').textContent = value.message || String(value);resize();}}
  function locked() {return context.status === 'submitted' || context.mode === 'history' || context.capabilities.canSave !== true;}
  function readAnswer() {return KIND === 'single' ? {selectedOptionId:[...selected][0] || null} : KIND === 'multiple' ? {selectedOptionIds:[...selected]} : {value:selected.size ? [...selected][0] === 'true' : null};}
  const saver = createAnswerSaver({context:() => context,answer:readAnswer,statuses:answer => [{status:(KIND === 'single' ? answer.selectedOptionId !== null : KIND === 'multiple' ? answer.selectedOptionIds.length > 0 : answer.value !== null) ? 'draft' : 'unanswered'}],onError:error,onBusy:value => {busy = value;controls();}});
  function render(name,host,doc) {views.get(name)?.destroy();const view = content.render(host,doc);views.set(name,view);const token = epoch;view.ready.then(() => {if (!disposed && token === epoch) resize();}).catch(error);}
  function controls() {
    if (!context) return;
    $('submit').hidden = context.status === 'submitted' || context.capabilities.canSubmit !== true;
    $('submit').disabled = acting || !selected.size;$('submit').textContent = acting && context.status !== 'submitted' ? '提交中…' : '提交';
    $('retry').hidden = context.status !== 'submitted' || context.capabilities.canRetry !== true;
    $('retry').disabled = acting;
    $('options').querySelectorAll('input').forEach(input => {input.disabled = locked();input.checked = selected.has(input.value);input.closest('.choice').classList.toggle('is-selected',input.checked);});
  }
  function changed(event) {
    if (locked() || !event.target.matches('input')) return;
    if (KIND === 'multiple') {if (event.target.checked) selected.add(event.target.value);else selected.delete(event.target.value);}
    else selected = new Set([event.target.value]);
    $('error').hidden = true;saver.changed();saver.reportProgress();controls();
  }
  // Clicking waits for any running draft save first (saver.submit flushes), and repeated clicks are ignored.
  async function act(task) {if (acting) return;acting = true;controls();try {await task();} finally {acting = false;controls();}}
  async function submit() {if (acting || !selected.size || context.capabilities.canSubmit !== true) return;await act(() => saver.submit());}
  async function retry() {if (acting || context.capabilities.canRetry !== true) return;await act(() => saver.retry());}
  const submitHandler = () => submit().catch(error), retryHandler = () => retry().catch(error);
  $('options').addEventListener('change',changed);$('submit').addEventListener('click',submitHandler);$('retry').addEventListener('click',retryHandler);
  QF.page.register({
    async onLoad(next) {
      const nextKey = next.mode + ':' + next.question.id;
      const rebuild = key !== nextKey || !context || context.status === 'submitted' || next.status === 'submitted';
      context = next;key = nextKey;
      if (!rebuild) {controls();return;}
      epoch++;saver.reset();views.forEach(view => view.destroy());views.clear();$('error').hidden = true;
      const data = next.question.data;
      selected = new Set(KIND === 'single' ? next.answer?.selectedOptionId ? [next.answer.selectedOptionId] : [] : KIND === 'multiple' ? next.answer?.selectedOptionIds || [] : typeof next.answer?.value === 'boolean' ? [String(next.answer.value)] : []);
      $('max-score').textContent = `${data.maxScore} 分`;render('stem',$('stem'),data.stem);$('options').replaceChildren();
      const options = KIND === 'true-false' ? [{id:'true',label:'正确'},{id:'false',label:'错误'}] : data.options;
      const correct = new Set(KIND === 'single' ? [data.correctOptionId] : KIND === 'multiple' ? data.correctOptionIds || [] : [String(data.correctAnswer)]);
      options.forEach((option,index) => {
        const row = document.createElement('label');row.className = 'choice';
        const input = document.createElement('input');input.type = KIND === 'multiple' ? 'checkbox' : 'radio';input.name = 'answer';input.value = option.id;input.setAttribute('aria-label',KIND === 'true-false' ? option.label : `选项 ${String.fromCharCode(65 + index)}`);
        const letter = document.createElement('span');letter.className = 'choice-letter';letter.textContent = KIND === 'true-false' ? option.label : String.fromCharCode(65 + index);row.append(input,letter);
        if (KIND !== 'true-false') {const host = document.createElement('div');host.className = 'choice-content';row.append(host);render(option.id,host,option.content);}
        if (next.status === 'submitted') {row.classList.toggle('is-correct',correct.has(option.id));row.classList.toggle('is-wrong',selected.has(option.id) && !correct.has(option.id));}
        $('options').append(row);
      });
      $('result').hidden = next.status !== 'submitted';
      if (next.status === 'submitted') {$('score-value').textContent = `${next.result.score} / ${next.result.maxScore} 分`;render('assessment',$('answer-and-explanation'),data.answerAndExplanation);}
      else $('answer-and-explanation').replaceChildren();
      controls();await Promise.all([...views.values()].map(view => view.ready));resize();
    },
    onFlush:() => saver.flush(),
    onDispose() {disposed = true;epoch++;saver.dispose();views.forEach(view => view.destroy());views.clear();$('options').removeEventListener('change',changed);$('submit').removeEventListener('click',submitHandler);$('retry').removeEventListener('click',retryHandler);}
  }).catch(error);
})();
