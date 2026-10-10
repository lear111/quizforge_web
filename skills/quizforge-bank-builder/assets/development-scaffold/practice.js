const stem = document.getElementById('stem');
const answer = document.getElementById('answer');
const submit = document.getElementById('submit');
const result = document.getElementById('result');
const explanation = document.getElementById('answer-and-explanation');
const score = document.getElementById('score');
const slider = document.getElementById('score-slider');
const sliderValue = document.getElementById('score-value');
const aiFeedback = document.getElementById('ai-feedback');
// Optional submitted-state UI; enable only when this question type needs it.
// These switches describe this page, not new host APIs or bank features.
const optionalTools = {scoreSlider: false, aiFeedback: false};
let current;
function showOptionalTools(preview) {
  document.getElementById('score-slider-area').hidden = !optionalTools.scoreSlider;
  document.getElementById('ai-feedback-area').hidden = !optionalTools.aiFeedback;
  slider.max = String(current.question.data.maxScore);
  slider.value = String(current.result?.score ?? 0);
  slider.disabled = current.mode === 'history' || !preview;
  sliderValue.textContent = preview ? '界面演示' : String(current.result?.score ?? 0);
  aiFeedback.value = preview ? 'AI 评价示意，尚未调用 AI 服务。' : typeof current.result?.feedback === 'string' ? current.result.feedback : '';
}
function showResultPreview() {
  result.hidden = false;
  score.hidden = true;
  explanation.textContent = '答案与解析示意：此处放参考答案和解析；需要时可在同一内容中加入评分标准。本次仅展示界面，没有保存或判分。';
  showOptionalTools(true);
  QF.ui.resize();
}
function previewScore() { sliderValue.textContent = `${Number(slider.value)}（界面演示，未保存）`; }
submit.addEventListener('click', showResultPreview);
slider.addEventListener('input', previewScore);
QF.page.register({
  onLoad(context) {
    current = context;
    stem.textContent = context.question.data.stem;
    answer.value = context.answer?.text ?? '';
    answer.disabled = context.mode === 'history' || context.status === 'submitted';
    submit.hidden = context.mode === 'history' || context.status === 'submitted';
    result.hidden = context.status !== 'submitted';
    explanation.textContent = context.status === 'submitted' ? context.question.data.answerAndExplanation || '' : '';
    score.hidden = !context.result || !Number.isFinite(context.result.score);
    score.textContent = score.hidden ? '' : `${context.result.score} / ${context.result.maxScore} 分`;
    if (!result.hidden) showOptionalTools(false);
  },
  onDispose() {
    submit.removeEventListener('click', showResultPreview);
    slider.removeEventListener('input', previewScore);
  }
}).catch(error => { const notice = document.getElementById('error'); notice.hidden = false; notice.textContent = error.message; });
