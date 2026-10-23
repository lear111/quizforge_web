// 听力理解题型作者页逻辑（构建时与 audio-player.js 合并成 editor.js）
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const content = QF.content;
  const copy = value => JSON.parse(JSON.stringify(value));
  const empty = () => copy(content.EMPTY_DOCUMENT);
  const views = new Map(), hosts = new Map(), audioSources = new Map();
  let originalTitle = '';
  let draft, baseline = '', active = null, editor = null, switching = Promise.resolve(), disposed = false, editable = false, preview = null;
  let importedAudio = null, importedSource = '', importController = null, pendingImport = Promise.resolve();
  const resize = () => {if (!disposed) QF.ui.resize();};
  function showError(error) {if (disposed) return; $('error').hidden = false; $('error').textContent = error.message || String(error); resize();}
  function getDoc(key) {return key === 'stem' ? draft.stem : key === 'assessment' ? draft.answerAndExplanation : draft.options.find(option => option.id === key)?.content;}
  function setDoc(key, doc) {if (key === 'stem') draft.stem = copy(doc); else if (key === 'assessment') draft.answerAndExplanation = copy(doc); else {const option = draft.options.find(value => value.id === key); if (option) option.content = copy(doc);}}
  function capture() {
    if (editor && active) setDoc(active, editor.getDocument());
    return {...copy(draft), maxScoreText: $('edit-max-score').value};
  }
  function updateScore() {
    const input = $('edit-max-score');
    const value = Number(input.value);
    const valid = input.value.trim() !== '' && Number.isFinite(value) && value > 0 && value <= 100000;
    input.setCustomValidity(valid ? '' : '满分须大于 0，最多 100000');
    input.setAttribute('aria-invalid', String(!valid));
    input.style.width = `${Math.max(1.5, Math.min(11, input.value.length + .5))}ch`;
  }
  function label(path) {
    const name = String(path || '').split('/').pop().replace(/\.[a-z0-9]+$/i, '');
    const titles = {'listen-01': '第 1 段材料', 'listen-02': '第 2 段材料', 'listen-03': '第 3 段材料'};
    return titles[name] ? `${titles[name]}（${name}）` : name;
  }
  function audioOptions() {
    const select = $('edit-audio');
    select.replaceChildren();
    for (const path of audioSources.keys()) {
      const option = document.createElement('option');
      option.value = path; option.textContent = label(path);
      select.append(option);
    }
    if (QFListeningAudio.isInline(draft?.audio)) importedSource = draft.audio;
    if (importedSource) {const option = document.createElement('option');option.value = '__local_audio__';option.textContent = '本题导入的音频';select.append(option);}
    select.value = QFListeningAudio.isInline(draft?.audio) ? '__local_audio__' : draft && audioSources.has(draft.audio) ? draft.audio : [...audioSources.keys()][0] || '';
  }
  function stopPreview() {
    if (!preview) return;
    try {preview.destroy();} catch (error) { /* 已销毁 */ }
    preview = null;
    importedAudio?.remove(); importedAudio = null;
    $('audio-preview').replaceChildren();
  }
  function startPreview() {
    stopPreview();
    if (disposed || typeof QFAudioPlayer === 'undefined') return;
    let element = audioSources.get(draft.audio);
    if (QFListeningAudio.isInline(draft.audio)) {
      importedAudio = new Audio(draft.audio);importedAudio.dataset.importedAudio = 'true';
      $('audio-slot').append(importedAudio);element = importedAudio;
    }
    if (!element) return;
    try {element.currentTime = 0;} catch (error) { /* 元数据未就绪 */ }
    preview = QFAudioPlayer.create($('audio-preview'), {
      audio: element, badge: '试听', title: typeof draft.audioTitle === 'string' ? draft.audioTitle.trim() : '',
      step: 15, speeds: [0.75, 1, 1.25, 1.5, 2], exclusive: true, ariaLabel: '音频试听'
    });
    preview.on('error', () => resize());
    resize();
  }
  function previewDoc(key) {
    const host = hosts.get(key); if (!host) return;
    views.get(key)?.destroy(); views.delete(key);
    host.classList.remove('is-editing'); host.setAttribute('role', 'button'); host.tabIndex = editable ? 0 : -1;
    if (content.isEmpty(getDoc(key))) {host.replaceChildren(); const hint = document.createElement('div'); hint.className = 'empty-field'; hint.textContent = '点击填写'; host.append(hint);}
    else {const view = content.render(host, getDoc(key)); views.set(key, view); view.ready.then(resize).catch(showError);}
    resize();
  }
  async function closeEditor() {
    if (!editor) return;
    await editor.flush();
    capture();
    const previous = active;
    editor.destroy(); editor = null; active = null;
    previewDoc(previous);
  }
  async function activate(key) {
    if (!editable || disposed || key === active || !hosts.has(key)) return;
    await closeEditor();
    if (disposed || !hosts.has(key)) return;
    const host = hosts.get(key);
    views.get(key)?.destroy(); views.delete(key);
    host.classList.add('is-editing'); host.removeAttribute('role'); host.tabIndex = -1;
    active = key;
    const candidate = content.createEditor(host, {
      doc: getDoc(key) || empty(), placeholder: '',
      resources: {get:id => QF.resources.get(id), put:file => QF.resources.put(file)},
      onChange(doc) {if (!disposed && active === key) {setDoc(key, doc); resize();}}
    });
    editor = candidate;
    await candidate.ready;
    if (disposed || editor !== candidate) {candidate.destroy(); return;}
    candidate.focus(); resize();
  }
  function schedule(operation) {switching = switching.catch(() => {}).then(operation); switching.catch(showError);}
  function updateCorrect() {
    $('option-editors').querySelectorAll('.choice').forEach(row => {
      const correct = row.dataset.id === draft.correctOptionId;
      row.classList.toggle('is-correct', correct);
      row.querySelector('input[type=radio]').checked = correct;
    });
  }
  function buildOptions() {
    for (const [key, view] of views) if (key !== 'stem' && key !== 'assessment') {view.destroy(); views.delete(key);}
    for (const key of hosts.keys()) if (key !== 'stem' && key !== 'assessment') hosts.delete(key);
    $('option-editors').replaceChildren();
    draft.options.forEach((option, index) => {
      const letter = String.fromCharCode(65 + index);
      const row = document.createElement('div'); row.className = 'choice'; row.dataset.id = option.id;
      const radio = document.createElement('input'); radio.type = 'radio'; radio.name = 'correct-option'; radio.value = option.id; radio.disabled = !editable; radio.setAttribute('aria-label', `将选项 ${letter} 设为正确答案`);
      const marker = document.createElement('span'); marker.className = 'choice-letter'; marker.textContent = letter;
      const host = document.createElement('div'); host.className = 'editable-field'; host.dataset.field = option.id; host.setAttribute('aria-label', `编辑选项 ${letter}`);
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'remove-option'; remove.textContent = '×'; remove.dataset.remove = option.id; remove.setAttribute('aria-label', `删除选项 ${letter}`); remove.disabled = !editable || draft.options.length <= 2;
      row.append(radio, marker, host, remove); $('option-editors').append(row);
      hosts.set(option.id, host); previewDoc(option.id);
    });
    $('add-option').disabled = !editable || draft.options.length >= 26;
    updateCorrect(); resize();
  }
  function chooseCorrect(event) {if (editable && event.target.matches('input[type=radio]')) {draft.correctOptionId = event.target.value; updateCorrect();}}
  function requestEdit(event) {
    if (event.type === 'keydown' && !['Enter', ' '].includes(event.key)) return;
    const host = event.target.closest('.editable-field');
    if (!host || host.classList.contains('is-editing')) return;
    if (event.type === 'keydown') event.preventDefault();
    schedule(() => activate(host.dataset.field));
  }
  function addOption() {
    if (!editable || draft.options.length >= 26) return;
    schedule(async () => {
      await closeEditor();
      if (disposed || draft.options.length >= 26) return;
      let number = 1; while (draft.options.some(option => option.id === `choice${number}`)) number++;
      const id = `choice${number}`; draft.options.push({id, content: empty()});
      buildOptions(); await activate(id);
    });
  }
  function removeOption(event) {
    const button = event.target.closest('button[data-remove]');
    if (!editable || !button || draft.options.length <= 2) return;
    const id = button.dataset.remove;
    schedule(async () => {await closeEditor(); if (disposed || draft.options.length <= 2 || !draft.options.some(option => option.id === id)) return; draft.options = draft.options.filter(option => option.id !== id); if (draft.correctOptionId === id) draft.correctOptionId = null; buildOptions();});
  }
  function chooseAudio(event) {
    if (!editable) {audioOptions(); return;}
    draft.audio = event.target.value === '__local_audio__' ? importedSource : event.target.value;
    startPreview();
  }
  function importStatus(message) {$('audio-import-status').textContent = message;resize();}
  function cancelImport() {importController?.abort();}
  function importAudio(event) {
    const file = event.target.files?.[0];event.target.value = '';
    if (!editable || !file || importController) return;
    const controller = new AbortController();importController = controller;
    $('audio-file').disabled = true;$('edit-audio').disabled = true;$('audio-import-cancel').hidden = false;
    pendingImport = QFListeningImport.importFile(file,{signal:controller.signal,onProgress:importStatus}).then(result => {
      if (disposed || controller.signal.aborted) return;
      draft.audio = result.data;importedSource = result.data;
      if (!draft.audioTitle?.trim()) {draft.audioTitle = file.name.replace(/\.[^.]+$/,'').slice(0,200);$('edit-audio-title').value = draft.audioTitle;}
      audioOptions();startPreview();
      importStatus(`已导入并压缩：${(result.originalBytes / 1024).toFixed(0)} KB → ${(result.bytes / 1024).toFixed(0)} KB。保存题目后生效。`);
    }).catch(error => {
      if (!disposed) importStatus(error.name === 'AbortError' ? '已取消导入，原音频保持不变。' : (error.message || '音频导入失败，原音频保持不变。'));
    }).finally(() => {
      if (importController !== controller) return;
      importController = null;
      if (!disposed) {$('audio-file').disabled = !editable;$('edit-audio').disabled = !editable;$('audio-import-cancel').hidden = true;resize();}
    });
  }
  function renameAudio(event) {
    if (!editable) return;
    draft.audioTitle = event.target.value;
    const titleEl = $('audio-preview').querySelector('.qfa-title');
    if (titleEl) {titleEl.textContent = draft.audioTitle.trim(); titleEl.hidden = !draft.audioTitle.trim();}
  }
  for (const element of document.querySelectorAll('audio[data-asset]')) audioSources.set(element.getAttribute('data-asset'), element);
  const root = document.querySelector('.authoring');
  root.addEventListener('click', requestEdit); root.addEventListener('keydown', requestEdit);
  $('option-editors').addEventListener('change', chooseCorrect);
  $('option-editors').addEventListener('click', removeOption);
  $('add-option').addEventListener('click', addOption);
  $('edit-max-score').addEventListener('input', updateScore);
  $('edit-audio').addEventListener('change', chooseAudio);
  $('edit-audio-title').addEventListener('input', renameAudio);
  $('audio-file').addEventListener('change', importAudio);
  $('audio-import-cancel').addEventListener('click', cancelImport);
  QF.editor.register({
    async onLoad(context) {
      cancelImport();await pendingImport;importedSource = '';
      originalTitle = context.question.title;
      await switching;
      editor?.destroy(); editor = null; active = null;
      views.forEach(view => view.destroy()); views.clear(); hosts.clear();
      draft = copy(context.question.data);
      if (!Object.hasOwn(draft, 'audio') && audioSources.size) draft.audio = [...audioSources.keys()][0];
      editable = context.capabilities?.canEdit === true;
      $('edit-max-score').value = String(draft.maxScore);
      $('edit-max-score').disabled = !editable;
      $('edit-audio').disabled = !editable;
      $('audio-file').disabled = !editable;
      $('audio-import-status').textContent = '';
      $('edit-audio-title').disabled = !editable;
      $('edit-audio-title').value = typeof draft.audioTitle === 'string' ? draft.audioTitle : '';
      audioOptions(); updateScore();
      hosts.set('stem', $('edit-stem')); hosts.set('assessment', $('edit-assessment'));
      $('edit-stem').dataset.field = 'stem'; $('edit-assessment').dataset.field = 'assessment';
      $('error').hidden = true;
      startPreview();
      previewDoc('stem'); buildOptions(); previewDoc('assessment');
      await Promise.all([...views.values()].map(view => view.ready)); resize();
      baseline = JSON.stringify(capture());
    },
    hasChanges() {return Boolean(draft) && JSON.stringify(capture()) !== baseline;},
    async getDocument() {
      await pendingImport;await switching; await editor?.flush(); capture();
      const raw = $('edit-max-score').value;
      if (!raw.trim() || !Number.isFinite(Number(raw)) || Number(raw) <= 0 || Number(raw) > 100000) throw new Error('请填写有效的分值');
      if (!audioSources.has(draft.audio) && !QFListeningAudio.isInline(draft.audio)) throw new Error('请选择听力音频');
      draft.maxScore = Number(raw); draft.playLimit = 0;
      if (typeof draft.audioTitle === 'string' && !draft.audioTitle.trim()) delete draft.audioTitle; else if (typeof draft.audioTitle === 'string') draft.audioTitle = draft.audioTitle.trim();
      for (const doc of [draft.stem, draft.answerAndExplanation, ...draft.options.map(option => option.content)]) if (!content.validateDocument(doc) || content.isEmpty(doc)) throw new Error('请填写完整的题干、选项和答案与解析');
      if (!draft.options.some(option => option.id === draft.correctOptionId)) throw new Error('请选择正确答案');
      return {title: originalTitle, data: copy(draft)};
    },
    async exportDraft() {await pendingImport;await switching; await editor?.flush(); return {schemaVersion:1, form:capture()};},
    async importDraft(value) {
      cancelImport();await pendingImport;
      if (!value || value.schemaVersion !== 1 || !value.form) throw new Error('编辑草稿无效');
      await switching; editor?.destroy(); editor = null; active = null;
      const form = copy(value.form);
      const {maxScoreText, playLimitText, ...data} = form;
      draft = data;
      $('edit-max-score').value = String(maxScoreText ?? draft.maxScore);
      $('edit-audio-title').value = typeof draft.audioTitle === 'string' ? draft.audioTitle : '';
      audioOptions(); updateScore(); startPreview();
      previewDoc('stem'); buildOptions(); previewDoc('assessment');
      await Promise.all([...views.values()].map(view => view.ready)); resize();
    },
    async onFlush() {await pendingImport;await switching; await editor?.flush();},
    onDispose() {
      disposed = true; editor?.destroy(); editor = null;
      cancelImport();
      stopPreview();
      views.forEach(view => view.destroy()); views.clear(); hosts.clear();
      root.removeEventListener('click', requestEdit); root.removeEventListener('keydown', requestEdit);
      $('option-editors').removeEventListener('change', chooseCorrect); $('option-editors').removeEventListener('click', removeOption); $('add-option').removeEventListener('click', addOption);
      $('edit-max-score').removeEventListener('input', updateScore);
      $('edit-audio').removeEventListener('change', chooseAudio);
      $('edit-audio-title').removeEventListener('input', renameAudio);
      $('audio-file').removeEventListener('change', importAudio);
      $('audio-import-cancel').removeEventListener('click', cancelImport);
    }
  }).catch(showError);
})();
