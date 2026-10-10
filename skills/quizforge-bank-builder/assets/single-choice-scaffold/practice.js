const stem = document.getElementById('stem');
const options = document.getElementById('options');
const submit = document.getElementById('submit');
const retry = document.getElementById('retry');
const result = document.getElementById('result');
const explanation = document.getElementById('answer-and-explanation');
const score = document.getElementById('score');
const slider = document.getElementById('score-slider');
const sliderValue = document.getElementById('score-value');
const aiFeedback = document.getElementById('ai-feedback');
// Optional local UI demonstrations, disabled unless this type needs them.
const optionalTools = {scoreSlider: false, aiFeedback: false};
// UI-only answer fixtures for the two bundled examples, not real grading.
// Update these fixtures with the examples when designing other representative questions.
// Actual submitted practice/history use the host-projected correctOptionId instead.
const previewAnswers = {'sample-division': 'A', 'sample-cache': 'refresh'};
let current;
let selectedId;
let previewSubmitted = false;
function readOnly() { return current.mode === 'history' || current.status === 'submitted'; }
function renderOptions() {
  options.querySelectorAll('.choice').forEach(option => option.remove());
  const correctId = current.status === 'submitted' ? current.question.data.correctOptionId
    : previewSubmitted ? previewAnswers[current.question.id] : null;
  current.question.data.options.forEach((option, index) => {
    const label = document.createElement('label'); label.className = 'choice';
    const isCorrect = Boolean(correctId) && option.id === correctId;
    const isIncorrect = Boolean(correctId) && option.id === selectedId && !isCorrect;
    label.classList.toggle('is-correct', isCorrect);
    label.classList.toggle('is-incorrect', isIncorrect);
    const input = document.createElement('input');
    input.type = 'radio'; input.name = 'answer-option'; input.value = option.id;
    input.checked = option.id === selectedId; input.disabled = readOnly() || previewSubmitted;
    input.setAttribute('aria-label', `${String.fromCharCode(65 + index)}. ${option.text}${isCorrect ? '，正确答案' : isIncorrect ? '，回答错误' : ''}`);
    const letter = document.createElement('span'); letter.className = 'choice-letter'; letter.textContent = String.fromCharCode(65 + index);
    const text = document.createElement('span'); text.className = 'choice-text'; text.textContent = option.text;
    label.append(input, letter, text); options.append(label);
  });
  submit.disabled = !selectedId || readOnly() || previewSubmitted;
}
function showOptionalTools(preview) {
  document.getElementById('score-slider-area').hidden = !optionalTools.scoreSlider;
  document.getElementById('ai-feedback-area').hidden = !optionalTools.aiFeedback;
  slider.max = String(current.question.data.maxScore);
  slider.value = String(current.result?.score ?? 0);
  slider.disabled = readOnly() || !preview;
  sliderValue.textContent = preview ? '界面演示' : String(current.result?.score ?? 0);
  aiFeedback.value = preview ? 'AI 评价示意，尚未调用 AI 服务。' : typeof current.result?.feedback === 'string' ? current.result.feedback : '';
}
function choose(event) {
  if (readOnly() || previewSubmitted || !event.target.matches('input[type="radio"]')) return;
  selectedId = event.target.value; submit.disabled = false;
}
function showResultPreview() {
  if (!selectedId || readOnly() || previewSubmitted) return;
  previewSubmitted = true; renderOptions();
  submit.hidden = true; retry.hidden = false; result.hidden = false; score.hidden = true;
  explanation.textContent = '答案与解析示意：正式接入后显示正确选项和解析。本次仅展示提交后布局，没有保存或判分。';
  showOptionalTools(true); QF.ui.resize();
}
function retryPreview() {
  if (readOnly()) return;
  previewSubmitted = false; result.hidden = true; explanation.textContent = '';
  retry.hidden = true; submit.hidden = false;
  renderOptions(); QF.ui.resize();
}
function previewScore() { sliderValue.textContent = `${Number(slider.value)}（界面演示，未保存）`; }
options.addEventListener('change', choose);
submit.addEventListener('click', showResultPreview);
retry.addEventListener('click', retryPreview);
slider.addEventListener('input', previewScore);
QF.page.register({
  onLoad(context) {
    current = context; previewSubmitted = false;
    selectedId = context.answer?.selectedOptionId ?? null;
    if (!context.question.data.options.some(option => option.id === selectedId)) selectedId = null;
    stem.textContent = context.question.data.stem;
    renderOptions();
    submit.hidden = readOnly(); retry.hidden = true;
    result.hidden = context.status !== 'submitted';
    explanation.textContent = '';
    score.hidden = !context.result || !Number.isFinite(context.result.score);
    score.textContent = score.hidden ? '' : `${context.result.score} / ${context.result.maxScore} 分`;
    if (!result.hidden) {
      const data = context.question.data;
      const index = data.options.findIndex(option => option.id === data.correctOptionId);
      const reference = index < 0 ? '' : `正确答案：${String.fromCharCode(65 + index)}. ${data.options[index].text}\n`;
      explanation.textContent = reference + (data.answerAndExplanation || '');
      showOptionalTools(false);
    }
  },
  onDispose() {
    options.removeEventListener('change', choose);
    submit.removeEventListener('click', showResultPreview);
    retry.removeEventListener('click', retryPreview);
    slider.removeEventListener('input', previewScore);
  }
}).catch(error => { const notice = document.getElementById('error'); notice.hidden = false; notice.textContent = error.message; });
