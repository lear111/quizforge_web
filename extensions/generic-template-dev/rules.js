QF.defineType({
  project(data, state) {
    const projected = {stem: data.stem, maxScore: data.maxScore};
    if (state?.submitted) projected.answerAndExplanation = data.answerAndExplanation || '';
    return projected;
  },
  getScore(data, state) {
    return state.submitted
      ? {score: state.result.score, maxScore: state.result.maxScore}
      : {score: 0, maxScore: data.maxScore};
  }
  // No grade/review yet: the development host reports DEVELOPMENT_NOT_IMPLEMENTED.
  // Implement real grading only after UI approval; never return a simulated grade.
});
