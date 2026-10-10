QF.defineType({
  validateQuestion(data) {
    const ids = data.options.map(option => option.id);
    return new Set(ids).size === ids.length && ids.includes(data.correctOptionId);
  },
  validateAnswer(answer, data) {
    return answer.selectedOptionId == null || data.options.some(option => option.id === answer.selectedOptionId);
  },
  project(data, state) {
    const projected = {
      stem: data.stem,
      options: data.options.map(option => ({id: option.id, text: option.text})),
      maxScore: data.maxScore
    };
    if (state?.submitted) {
      projected.correctOptionId = data.correctOptionId;
      projected.answerAndExplanation = data.answerAndExplanation;
    }
    return projected;
  },
  getScore(data, state) {
    return state?.submitted
      ? {score: state.result?.score ?? null, maxScore: state.result?.maxScore ?? data.maxScore}
      : {score: 0, maxScore: data.maxScore};
  }
  // Implement real grade/reset and persistence after UI approval.
  // The current page demonstrates submission locally and never fabricates a saved result.
});
