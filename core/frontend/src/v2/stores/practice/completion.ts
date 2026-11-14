import { toRaw } from 'vue';
import { isSaveConflict } from '../../services/save-policy';
import type { Overview, Completion } from '../../types/practice-types';
import type { PracticeSession } from '../../types/practice-session';

export async function reloadCompletedQuestion(ctx: PracticeSession) {
  const { current, message, api } = ctx;
  if (!current.value) {
    return;
  }
  try {
    await ctx.actions().applyContext(await api.questions.get(current.value));
  } catch (error) {
    // The bulk response already confirms the lock. Even if the follow-up
    // read fails, never leave an editable old frame behind the score screen.
    if (current.value && ctx.runtime.page) {
      try {
        await ctx.runtime.page.update(ctx.actions().context(current.value));
      } catch {
        /* Faulted pages keep their existing error screen. */
      }
    }
    message.value =
      error instanceof Error ? error.message : '题目暂时无法显示，已保存的分数不受影响。';
  }
}

export async function gradeCompleted(ctx: PracticeSession, value: Overview) {
  const { message } = ctx;
  try {
    const saved = await ctx.runtime.completionGrader!.run(toRaw(value));
    if (saved) {
      ctx.actions().applyCompletion(saved);
      await ctx.actions().reloadCompletedQuestion();
    }
    if (value.pendingGrading.some((row) => row.error)) {
      message.value = '部分题型暂不可用，仍可查看已保存的得分。';
    }
  } catch (error) {
    if (isSaveConflict(error)) {
      ctx.runtime.completionGrader!.clear();
    }
    throw error;
  }
}

export async function complete(ctx: PracticeSession) {
  const { overview, api } = ctx;
  if (!overview.value || overview.value.completedAt) {
    return;
  }
  await ctx.run('正在完成练习并评分', async () => {
    await ctx.actions().flush();
    const bank = overview.value!;
    let saved: Completion;
    try {
      saved = await ctx.runtime.queue.enqueue(() =>
        api.banks.finish(bank.bank.bankId, bank.snapshotId),
      );
    } catch (error) {
      // A lost response may follow a successful lock. Read its actual state;
      // offline failures still surface and may be retried without relocking.
      if (!isSaveConflict(error)) {
        try {
          const latest: Overview = await api.banks.overview(bank.bank.bankId);
          if (latest.completedAt) {
            ctx.actions().applyCompletion(latest);
            await ctx.actions().reloadCompletedQuestion();
          }
        } catch {
          /* Keep the original completion error. */
        }
      }
      throw error;
    }
    ctx.actions().applyCompletion(saved);
    await ctx.actions().reloadCompletedQuestion();
    await ctx.actions().gradeCompleted(overview.value!);
  });
}

export async function resumeCompletion(ctx: PracticeSession) {
  const { overview, message, api } = ctx;
  if (!overview.value?.completedAt) {
    return;
  }
  await ctx.run('正在评分', async () => {
    await ctx.actions().flush();
    const bank = overview.value!;
    const latest: Overview = await api.banks.overview(bank.bank.bankId);
    overview.value = latest;
    if (!latest.completedAt) {
      ctx.runtime.completionGrader!.clear();
      message.value = latest.notice ?? '';
      if (latest.initial.question) {
        await ctx.actions().show(latest.initial.question, false);
      } else {
        ctx.actions().clearQuestion(true);
      }
      return;
    }
    await ctx.actions().gradeCompleted(latest);
  });
}
