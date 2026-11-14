QF.page.register({
  async load(context) {
    const views = [QFRichText.render(document.getElementById('stem'), context.question.stem)];
    const options = document.getElementById('options');
    options.replaceChildren();
    for (const option of context.question.options) {
      const label = document.createElement('label'),
        input = document.createElement('input'),
        content = document.createElement('div');
      input.type = 'checkbox';
      input.value = option.id;
      input.checked = context.answer?.selected?.includes(option.id) === true;
      input.disabled = context.locked;
      input.setAttribute('aria-label', option.id);
      label.append(input, content);
      options.append(label);
      input.addEventListener('change', () =>
        QF.page.changed({
          kind: 'choice',
          answered: document.querySelectorAll('input:checked').length > 0,
        }),
      );
      views.push(QFRichText.render(content, option.content));
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
    return {
      selected: Array.from(document.querySelectorAll('input:checked'), (input) => input.value),
    };
  },
});
