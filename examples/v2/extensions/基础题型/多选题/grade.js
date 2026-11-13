QF.grader.register({
  grade(question, solution, answer, item) {
    const selected = answer?.selected ?? [];
    if (!Array.isArray(selected) || new Set(selected).size !== selected.length || selected.some(id => !question.options.some(option => option.id === id))) throw Error('作答包含无效选项');
    const correct = selected.length === solution.selected.length && selected.every(id => solution.selected.includes(id));
    return { status: 'graded', score: correct ? item.maxScore : 0, feedback: !selected.length ? '未作答' : correct ? '回答正确' : '回答错误' };
  }
});
