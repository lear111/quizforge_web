QF.page.register({
  async load(context) {
    const views = [QFRichText.render(document.getElementById('stem'), context.question.stem)];
    const options = document.getElementById('options');
    options.replaceChildren();
    for (const [value, text] of [
      [true, '正确'],
      [false, '错误'],
    ]) {
      const label = document.createElement('label'),
        input = document.createElement('input');
      input.type = 'radio';
      input.name = 'judgement';
      input.value = String(value);
      input.checked = context.answer?.value === value;
      input.disabled = context.locked;
      label.append(input, document.createTextNode(text));
      options.append(label);
      input.addEventListener('change', () => QF.page.changed({ kind: 'choice', answered: true }));
    }
    for (const name of ['submit', 'retry']) {
      const button = document.getElementById(name);
      button.hidden = !context.can[name];
      button.onclick = async () => {
        button.disabled = true;
        document.getElementById('action-error').textContent = '';
        try {
          await QF.page[name]();
        } catch (error) {
          document.getElementById('action-error').textContent = error.message;
        } finally {
          button.disabled = false;
        }
      };
    }
    document.getElementById('explanation').hidden = !context.locked;
    if (context.locked) {
      views.push(
        QFRichText.render(document.getElementById('solution'), context.solution.explanation),
      );
    }
    const result = document.getElementById('result');
    result.hidden = !context.result && !context.locked;
    result.textContent =
      typeof context.result?.score === 'number'
        ? `${context.result.score} / ${context.item.maxScore} 分`
        : (context.result?.message ??
          (context.result ? '待人工或 AI 评分' : context.locked ? '答案已锁定，等待评分' : ''));
    const feedback = document.getElementById('feedback');
    feedback.textContent =
      typeof context.result?.score === 'number'
        ? context.result.score === context.item.maxScore
          ? '回答正确'
          : '回答错误'
        : '';
    feedback.hidden = !feedback.textContent;
    await Promise.all(views.map((view) => view.ready));
  },
  getAnswer() {
    const selected = document.querySelector('input:checked');
    return { value: selected ? selected.value === 'true' : null };
  },
});
