QF.grader.register({
  grade(question, solution, answer, item) {
    const correct = answer?.selected === solution.selected;
    return { status: 'graded', score: correct ? item.maxScore : 0, feedback: correct ? '回答正确。' : '回答不正确，请查看解析。' };
  }
});
