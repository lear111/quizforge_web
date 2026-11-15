export const candidate = (id, type = 'a') => ({
  question: {
    questionId: id,
    extension: { artifactId: type },
    question: { prompt: id },
    solution: { expected: id },
    answer: { typed: id },
    item: { maxScore: 1 },
    submissionId: 'lock-' + id,
    state: { revision: 2 },
  },
  error: null,
});
export const overview = (pendingGrading, snapshotId = 's') => ({ snapshotId, pendingGrading });
export const result = (id, score = 1) => ({
  questionId: id,
  result: { score, parts: null, message: null },
});
export const row = (id, value) => ({
  questionId: id,
  submissionId: 'lock-' + id,
  expectedRevision: 2,
  result: value,
});
export function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
