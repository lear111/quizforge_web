QF.grader.register({
  grade(question, solution, answer, item) {
    const correct = answer?.selected === solution.selected;
    return { score: correct ? item.maxScore : 0 };
  }
});
