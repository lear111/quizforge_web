// 听力理解题型页面逻辑（构建时与 audio-player.js 合并成 practice.js）
// 依赖：全局 QFAudioPlayer（audio-player.js 提供）、宿主注入的 QF。

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
  const $ = id => document.getElementById(id), content = QF.content;
  const views = new Map(), audioSources = new Map();
  let context = null, disposed = false, busy = false, key = null, epoch = 0;
  let player = null, importedAudio = null, selected = new Set(), plays = 0;

  const resize = () => {if (!disposed) QF.ui.resize();};
  function error(value) {if (!disposed) {$('error').hidden = false;$('error').textContent = value.message || String(value);resize();}}
  function lockedInput() {return context.status === 'submitted' || context.mode === 'history' || context.capabilities.canSave !== true;}
  function readAnswer() {return {selectedOptionId:[...selected][0] || null,plays};}
  const saver = createAnswerSaver({context:() => context,answer:readAnswer,statuses:answer => [{status:answer.selectedOptionId !== null ? 'draft' : 'unanswered'}],onError:error,onBusy:value => {busy = value;controls();}});

  function render(name,host,doc) {views.get(name)?.destroy();const view = content.render(host,doc);views.set(name,view);const token = epoch;view.ready.then(() => {if (!disposed && token === epoch) resize();}).catch(error);}

  /* ---------- 音频资源：静态 <audio data-asset> 由宿主内联成 data URL ---------- */
  function collectAudio() {
    audioSources.clear();
    document.querySelectorAll('audio[data-asset]').forEach(element => {audioSources.set(element.getAttribute('data-asset'),element);});
  }

  /* ---------- 音频始终允许反复播放；旧题目与答案中的次数字段仅保留兼容 ---------- */
  function hint(text, tone) {
    const node = $('play-hint');
    if (!text) {node.hidden = true;node.textContent = '';return;}
    node.hidden = false;node.textContent = text;node.classList.toggle('is-warning',tone === 'warning');
  }
  function destroyPlayer() {
    if (!player) return;
    try {player.destroy();} catch (error) { /* 已销毁 */ }
    player = null;
    importedAudio?.remove(); importedAudio = null;
    $('player').replaceChildren();
  }

  function mountPlayer(data,initialPlays) {
    destroyPlayer();
    plays = Number.isInteger(initialPlays) ? Math.max(0, Math.min(5, initialPlays)) : 0;
    if (disposed || typeof QFAudioPlayer === 'undefined' || typeof QFAudioPlayer.create !== 'function') return;
    const path = typeof data.audio === 'string' ? data.audio : '';
    let element = path ? audioSources.get(path) : null;
    if (QFListeningAudio.isInline(path)) {
      importedAudio = new Audio(path);importedAudio.dataset.importedAudio = 'true';
      $('audio-slot').append(importedAudio);element = importedAudio;
    }
    if (!element) {
      hint(path ? `缺少音频资源：${path}` : '本题没有绑定音频资源','warning');
      return;
    }
    try {element.currentTime = 0;} catch (error) { /* 元数据尚未就绪，忽略 */ }
    player = QFAudioPlayer.create($('player'), {
      audio: element,
      badge: '听力材料',
      title: typeof data.audioTitle === 'string' ? data.audioTitle.trim() : '',
      step: 15,
      speeds: [0.75, 1, 1.25, 1.5, 2],
      exclusive: true,
      ariaLabel: '听力材料播放器'
    });
    player.on('error', () => resize());
    hint('音频可不限次数播放');
    resize();
  }

  function controls() {
    if (!context) return;
    $('submit').hidden = context.status === 'submitted' || context.capabilities.canSubmit !== true;
    $('submit').disabled = busy || !selected.size;
    $('retry').hidden = context.status !== 'submitted' || context.capabilities.canRetry !== true;
    $('retry').disabled = busy;
    $('options').querySelectorAll('input').forEach(input => {input.disabled = lockedInput();input.checked = selected.has(input.value);input.closest('.choice').classList.toggle('is-selected',input.checked);});
  }
  function changed(event) {
    if (lockedInput() || !event.target.matches('input')) return;
    selected = new Set([event.target.value]);
    $('error').hidden = true;saver.changed();saver.reportProgress();controls();
  }
  async function submit() {if (busy || !selected.size || context.capabilities.canSubmit !== true) return;player?.pause();await saver.submit();}
  async function retry() {if (busy || context.capabilities.canRetry !== true) return;await saver.retry();}
  const submitHandler = () => submit().catch(error), retryHandler = () => retry().catch(error);

  collectAudio();
  $('options').addEventListener('change',changed);
  $('submit').addEventListener('click',submitHandler);
  $('retry').addEventListener('click',retryHandler);

  QF.page.register({
    async onLoad(next) {
      const nextKey = next.mode + ':' + next.question.id;
      const rebuild = key !== nextKey || !context || context.status === 'submitted' || next.status === 'submitted';
      context = next;key = nextKey;
      if (!rebuild) {controls();return;}
      epoch++;saver.reset();views.forEach(view => view.destroy());views.clear();$('error').hidden = true;
      const data = next.question.data;
      selected = new Set(next.answer?.selectedOptionId ? [next.answer.selectedOptionId] : []);
      $('max-score').textContent = `${data.maxScore} 分`;
      render('stem',$('stem'),data.stem);
      mountPlayer(data, next.answer?.plays);
      $('options').replaceChildren();
      const correct = new Set([data.correctOptionId]);
      (data.options || []).forEach((option,index) => {
        const row = document.createElement('label');row.className = 'choice';
        const input = document.createElement('input');input.type = 'radio';input.name = 'answer';input.value = option.id;input.setAttribute('aria-label',`选项 ${String.fromCharCode(65 + index)}`);
        const letter = document.createElement('span');letter.className = 'choice-letter';letter.textContent = String.fromCharCode(65 + index);
        const host = document.createElement('div');host.className = 'choice-content';
        row.append(input,letter,host);
        render(option.id,host,option.content);
        if (next.status === 'submitted') {row.classList.toggle('is-correct',correct.has(option.id));row.classList.toggle('is-incorrect',selected.has(option.id) && !correct.has(option.id));}
        $('options').append(row);
      });
      $('result').hidden = next.status !== 'submitted';
      if (next.status === 'submitted') {$('score-value').textContent = `${next.result.score} / ${next.result.maxScore} 分`;render('assessment',$('answer-and-explanation'),data.answerAndExplanation);}
      else $('answer-and-explanation').replaceChildren();
      controls();await Promise.all([...views.values()].map(view => view.ready));resize();
    },
    onFlush: () => saver.flush(),
    onDispose() {
      disposed = true;epoch++;saver.dispose();
      destroyPlayer();
      views.forEach(view => view.destroy());views.clear();
      $('options').removeEventListener('change',changed);
      $('submit').removeEventListener('click',submitHandler);
      $('retry').removeEventListener('click',retryHandler);
    }
  }).catch(error);
})();
