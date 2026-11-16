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
  if (value.readOnly) {
    return;
  }
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

async function sendFinish(ctx: PracticeSession, bank: Overview): Promise<Completion> {
  const { api } = ctx;
  try {
    return await ctx.runtime.queue.enqueue(() =>
      api.banks.finish(bank.bank.bankId, bank.snapshotId),
    );
  } catch (error) {
    // A lost response may follow a successful lock. Verify its generation
    // before scoring, since a different tab may already have archived it.
    if (!isSaveConflict(error)) {
      const latest = await api.banks.overview(bank.bank.bankId).catch(() => null);
      if (latest?.completedAt && (!bank.exam || latest.snapshotId === bank.snapshotId)) {
        if (bank.exam) {
          return latest;
        }
        ctx.actions().applyCompletion(latest);
        await ctx.actions().reloadCompletedQuestion();
      }
    }
    throw error;
  }
}

export async function complete(ctx: PracticeSession) {
  const { overview } = ctx;
  if (!overview.value || overview.value.readOnly || overview.value.completedAt) {
    return;
  }
  await ctx.run(overview.value.exam ? '正在交卷并评分' : '正在完成练习并评分', async () => {
    const examSnapshot = overview.value?.exam ? overview.value.snapshotId : null;
    await ctx.actions().flush();
    const bank = overview.value;
    if (!bank || (examSnapshot && bank.snapshotId !== examSnapshot)) {
      return;
    }
    const saved = await sendFinish(ctx, bank);
    ctx.actions().applyCompletion(saved);
    await ctx.actions().reloadCompletedQuestion();
    await ctx.actions().gradeCompleted(overview.value!);
  });
}

export async function resumeCompletion(ctx: PracticeSession) {
  const { overview, message, api } = ctx;
  if (!overview.value?.completedAt || overview.value.readOnly) {
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
