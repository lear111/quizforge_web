QF.grader.register({
  grade(question, solution, answer, item) {
    const value = answer?.value ?? null;
    if (value !== null && typeof value !== 'boolean') throw new TypeError('判断题答案必须是布尔值或 null。');
    const correct = value !== null && value === solution.value;
    return { status: 'graded', score: correct ? item.maxScore : 0, feedback: value === null ? '未作答' : correct ? '回答正确' : '回答错误' };
  }
});
