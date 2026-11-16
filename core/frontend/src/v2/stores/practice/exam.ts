import type { PracticeSession } from '../../types/practice-session';
import { installRound } from './restart';

export async function startExam(ctx: PracticeSession, durationMinutes: number) {
  const bank = ctx.overview.value;
  if (!bank || bank.readOnly || bank.exam || bank.bank.features.exam === false) {
    return;
  }
  await ctx.run('正在开始考试', async () => {
    await ctx.actions().flush();
    const next = await ctx.runtime.queue.enqueue(() =>
      ctx.api.banks.startExam(bank.bank.bankId, bank.snapshotId, durationMinutes),
    );
    await installRound(ctx, next);
  });
}
