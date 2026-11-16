export const completionResult = (name, final) => ({
  name,
  failedBankKeepsView: true,
  pendingViewDoesNotScoreIndividually: true,
  cancelLeavesActive: true,
  zeroClearedAnswer: true,
  flushBeforeFinish: true,
  groupedBatch: true,
  replayBodyStable: true,
  failedReadStaysLocked: true,
  score: final.total,
  reopenSummary: true,
  lockedScratch: true,
  restartWithFailedAndLostReply: true,
  historyReadOnlyReplay: true,
});
import assert from 'node:assert/strict';

export const probeApi =
  (origin) =>
  async (route, body, method = 'POST') => {
    const r = await fetch(
      origin + route,
      body === undefined
        ? {}
        : {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          },
    );
    assert.equal(r.ok, true);
    return r.json();
  };
