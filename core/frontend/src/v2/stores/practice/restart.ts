import type { PracticeSession } from '../../types/practice-session';
import { writeBody } from '../../api/requests';

export async function restart(ctx: PracticeSession) {
  const value = ctx.overview.value;
  if (!value?.completedAt) {
    return;
  }
  await ctx.run('正在归档上一轮练习', async () => {
    await ctx.actions().flush();
    const bankId = value.bank.bankId;
    const pending = ctx.runtime.restartRequest;
    // Freeze only after the save barrier; a lost response reuses exactly the
    // same request, even if its first send already committed on the host.
    const request =
      pending?.bankId === bankId && pending.snapshotId === value.snapshotId
        ? pending
        : { bankId, snapshotId: value.snapshotId, body: writeBody(value.snapshotId, {}) };
    ctx.runtime.restartRequest = request;
    const next = await ctx.runtime.queue.enqueue(() => ctx.api.banks.restart(bankId, request.body));
    ctx.runtime.restartRequest = null;
    ctx.actions().clearQuestion(true);
    ctx.actions().resetSources();
    ctx.runtime.grader?.dispose();
    ctx.runtime.completionGrader?.clear();
    ctx.actions().initializeRuntime(ctx.runtime.nonce);
    ctx.lastQuestions.value.delete(bankId);
    ctx.overview.value = next;
    ctx.scoreView.value = false;
    ctx.drawer.value = null;
    ctx.drafting.value = false;
    ctx.runtime.scratch?.setMode(false);
    if (next.initial.question) {
      await ctx.actions().show(next.initial.question, false);
    }
    ctx.message.value = next.initial.error?.message ?? next.notice ?? '';
  });
}
