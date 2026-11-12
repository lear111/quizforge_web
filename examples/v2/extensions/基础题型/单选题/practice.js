QF.page.register({
  async load(context) {
    const views = [QFRichText.render(document.getElementById('stem'), context.question.stem)];
    const options = document.getElementById('options'); options.replaceChildren();
    for (const option of context.question.options) {
      const label = document.createElement('label'), input = document.createElement('input'), content = document.createElement('div');
      input.type = 'radio'; input.name = 'choice'; input.value = option.id; input.checked = context.answer?.selected === option.id; input.disabled = context.locked;
      input.setAttribute('aria-label', option.id); label.append(input, content); options.append(label);
      views.push(QFRichText.render(content, option.content));
    }
    document.getElementById('explanation').hidden = !context.locked;
    if (context.locked) views.push(QFRichText.render(document.getElementById('solution'), context.solution.explanation));
    await Promise.all(views.map(view => view.ready));
  },
  getAnswer() { return { selected: document.querySelector('input:checked')?.value ?? null }; }
});
