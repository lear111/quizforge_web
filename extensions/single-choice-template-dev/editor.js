const stem = document.getElementById('stem');
const explanation = document.getElementById('answer-and-explanation');
const maxScore = document.getElementById('max-score');
const optionEditors = document.getElementById('option-editors');
const addButton = document.getElementById('add-option');
let editable = false;
let original;
let correctId = '';
let optionWidth = 0;
function resizeOption(input) {
  input.style.height = 'auto';
  input.style.height = `${Math.max(40, input.scrollHeight + 2)}px`;
}
const widthObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(entries => {
  const width = entries[0]?.contentRect.width;
  if (!width || width === optionWidth) return;
  optionWidth = width;
  optionEditors.querySelectorAll('textarea').forEach(resizeOption);
  QF.ui.resize();
}) : null;
widthObserver?.observe(optionEditors);
function readOptions() {
  return Array.from(optionEditors.querySelectorAll('.option-row'), row => ({id: row.dataset.id, text: row.querySelector('textarea').value}));
}
function readFields() {
  return {stem: stem.value, options: readOptions(), correctOptionId: correctId, answerAndExplanation: explanation.value, maxScoreText: maxScore.value};
}
function updateCorrect(selected = correctId) {
  correctId = readOptions().some(option => option.id === selected) ? selected : '';
  optionEditors.querySelectorAll('.option-row').forEach(row => {
    const chosen = row.dataset.id === correctId;
    row.classList.toggle('is-correct', chosen);
    row.querySelector('.correct-selector').checked = chosen;
  });
}
function renderOptions(values, selected) {
  optionEditors.replaceChildren();
  values.forEach((option, index) => {
    const row = document.createElement('div'); row.className = 'option-row'; row.dataset.id = option.id;
    const radio = document.createElement('input'); radio.type = 'radio'; radio.name = 'correct-answer';
    radio.className = 'correct-selector'; radio.id = `correct-option-${index}`; radio.value = option.id; radio.disabled = !editable;
    const letter = document.createElement('label'); letter.className = 'choice-letter'; letter.textContent = String.fromCharCode(65 + index);
    letter.htmlFor = radio.id; radio.setAttribute('aria-label', `将选项 ${letter.textContent} 设为正确答案`);
    const input = document.createElement('textarea'); input.id = `option-text-${index}`; input.rows = 1;
    input.value = option.text; input.disabled = !editable; input.setAttribute('aria-label', `选项 ${letter.textContent} 内容`);
    const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '×'; remove.dataset.remove = option.id;
    remove.setAttribute('aria-label', `删除选项 ${letter.textContent}`); remove.disabled = !editable || values.length <= 2;
    row.append(radio, letter, input, remove); optionEditors.append(row); resizeOption(input);
  });
  addButton.disabled = !editable || values.length >= 26;
  updateCorrect(selected);
}
function addOption() {
  if (!editable) return;
  const values = readOptions(); if (values.length >= 26) return;
  let number = 1; while (values.some(option => option.id === `choice${number}`)) number++;
  values.push({id: `choice${number}`, text: ''}); renderOptions(values, correctId); QF.ui.resize();
}
function removeOption(event) {
  const button = event.target.closest('button[data-remove]');
  if (!editable || !button || readOptions().length <= 2) return;
  renderOptions(readOptions().filter(option => option.id !== button.dataset.remove), correctId); QF.ui.resize();
}
function chooseCorrect(event) {
  if (!editable || event.target.closest('button[data-remove]')) return;
  const row = event.target.closest('.option-row');
  if (row) updateCorrect(row.dataset.id);
}
function changeOption(event) {
  if (!editable || !event.target.matches('textarea')) return;
  resizeOption(event.target); QF.ui.resize();
}
addButton.addEventListener('click', addOption);
optionEditors.addEventListener('click', removeOption);
optionEditors.addEventListener('click', chooseCorrect);
optionEditors.addEventListener('change', chooseCorrect);
optionEditors.addEventListener('input', changeOption);
QF.editor.register({
  onLoad(context) {
    const data = context.question.data;
    editable = context.mode === 'edit' && Boolean(context.capabilities?.canEdit);
    stem.value = data.stem; explanation.value = data.answerAndExplanation; maxScore.value = String(data.maxScore);
    for (const input of [stem, explanation, maxScore]) input.disabled = !editable;
    renderOptions(data.options, data.correctOptionId);
    original = JSON.stringify(readFields());
  },
  hasChanges() { return JSON.stringify(readFields()) !== original; },
  getDocument() {
    const error = new Error('选择题编辑界面演示尚未实现保存，请在 UI 确认后补齐文档导出。');
    error.code = 'DEVELOPMENT_NOT_IMPLEMENTED'; throw error;
  },
  exportDraft() { return {formatVersion: 1, ...readFields()}; },
  importDraft(draft) {
    const strings = ['stem', 'correctOptionId', 'answerAndExplanation', 'maxScoreText'];
    if (draft?.formatVersion !== 1 || strings.some(key => typeof draft[key] !== 'string') || !Array.isArray(draft.options) || draft.options.length < 2 || draft.options.length > 26 || draft.options.some(option => typeof option?.id !== 'string' || typeof option.text !== 'string') || new Set(draft.options.map(option => option.id)).size !== draft.options.length) throw new Error('编辑草稿格式无效');
    stem.value = draft.stem; explanation.value = draft.answerAndExplanation; maxScore.value = draft.maxScoreText;
    renderOptions(draft.options, draft.correctOptionId);
  },
  onDispose() {
    addButton.removeEventListener('click', addOption);
    optionEditors.removeEventListener('click', removeOption);
    optionEditors.removeEventListener('click', chooseCorrect);
    optionEditors.removeEventListener('change', chooseCorrect);
    optionEditors.removeEventListener('input', changeOption);
    widthObserver?.disconnect();
  }
}).catch(error => { const notice = document.getElementById('error'); notice.hidden = false; notice.textContent = error.message; });
