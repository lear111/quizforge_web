const stem = document.getElementById('stem');
const explanation = document.getElementById('answer-and-explanation');
const maxScore = document.getElementById('max-score');
let original;
const readFields = () => ({stem: stem.value, answerAndExplanation: explanation.value, maxScoreText: maxScore.value});
QF.editor.register({
  onLoad(context) {
    const data = context.question.data;
    stem.value = data.stem;
    explanation.value = data.answerAndExplanation || '';
    maxScore.value = String(data.maxScore);
    const editable = context.mode === 'edit' && context.capabilities?.canEdit;
    for (const input of [stem, explanation, maxScore]) input.disabled = !editable;
    original = JSON.stringify(readFields());
  },
  hasChanges() { return JSON.stringify(readFields()) !== original; },
  getDocument() {
    // After UI approval, implement {title, data} using the actual type schema.
    // Keep title as metadata; do not introduce another visible title field.
    const error = new Error('编辑界面演示尚未实现保存，请在 UI 确认后补齐文档导出。');
    error.code = 'DEVELOPMENT_NOT_IMPLEMENTED';
    throw error;
  },
  exportDraft() { return {formatVersion: 1, ...readFields()}; },
  importDraft(draft) {
    if (draft?.formatVersion !== 1 || ['stem', 'answerAndExplanation', 'maxScoreText'].some(key => typeof draft[key] !== 'string')) throw new Error('编辑草稿格式无效');
    stem.value = draft.stem;
    explanation.value = draft.answerAndExplanation;
    maxScore.value = draft.maxScoreText;
  }
}).catch(error => { const notice = document.getElementById('error'); notice.hidden = false; notice.textContent = error.message; });
