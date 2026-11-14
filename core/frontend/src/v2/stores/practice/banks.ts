import { nextTick } from 'vue';
import type { Overview, Question } from '../../types/practice-types';
import type { PracticeSession } from '../../types/practice-session';

export function remember(ctx: PracticeSession, q: Question) {
  const { lastQuestions } = ctx;
  lastQuestions.value.delete(q.bankId);
  lastQuestions.value.set(q.bankId, q.questionId);
  while (lastQuestions.value.size > 8) {
    lastQuestions.value.delete(lastQuestions.value.keys().next().value!);
  }
}

export async function catalog(ctx: PracticeSession) {
  const { authRequired, api } = ctx;
  await ctx.run('正在读取题库', async () => {
    await ctx.catalogStore.read(api);
    authRequired.value = false;
  });
}

export async function openBank(
  ctx: PracticeSession,
  _kind: string,
  id?: string,
  questionId?: string,
) {
  const { overview, current, message, scoreView, drawer, lastQuestions, api } = ctx;
  if (!id) {
    return;
  }
  await ctx.run('正在打开题库', async () => {
    await ctx.actions().flush();
    const value: Overview = await api.banks.overview(id);
    const remembered = questionId ?? lastQuestions.value.get(id);
    const initial =
      remembered &&
      (questionId || value.states.some((state) => state.questionId === remembered)) &&
      remembered !== value.initial.question?.questionId
        ? await api.questions.get({
            bankId: id,
            questionId: remembered,
            snapshotId: value.snapshotId,
          })
        : value.initial.question;
    const previous = overview.value,
      previousScoreView = scoreView.value;
    ctx.actions().resetSources();
    ctx.actions().scopeSources(value.bank.bankId, value.snapshotId);
    overview.value = value;
    scoreView.value = !!value.completedAt;
    drawer.value = null;
    if (initial) {
      try {
        await ctx.actions().show(initial, false);
      } catch (error) {
        if (current.value?.bankId !== value.bank.bankId) {
          overview.value = previous;
          await nextTick();
          scoreView.value = previousScoreView;
        }
        throw error;
      }
    } else {
      ctx.actions().clearQuestion();
      message.value = value.initial.error?.message ?? '题库没有题目。';
    }
    if (value.notice) {
      message.value = value.notice;
    }
    await ctx.actions().recoverPending(value);
  });
}

export async function navigate(ctx: PracticeSession, id: string) {
  const { overview, current, busy, scoreView, drawer, api } = ctx;
  if (!overview.value) {
    return;
  }
  if (id === current.value?.questionId && !ctx.actions().pageFaulted()) {
    if (!busy.value) {
      scoreView.value = false;
      drawer.value = null;
    }
    return;
  }
  await ctx.run('正在打开题目', async () => {
    await ctx.actions().flush();
    const bank = overview.value;
    if (!bank) {
      return;
    }
    await ctx.actions().show(
      await api.questions.get({
        bankId: bank.bank.bankId,
        questionId: id,
        snapshotId: bank.snapshotId,
      }),
    );
    scoreView.value = false;
    drawer.value = null;
  });
}

export async function refreshBank(ctx: PracticeSession) {
  const { overview, current, message, scoreView, api } = ctx;
  if (!overview.value) {
    return;
  }
  await ctx.run('正在刷新题库', async () => {
    await ctx.actions().flush();
    const active = current.value,
      bank = overview.value!;
    const value: Overview = await api.banks.refresh(bank.bank.bankId, active?.questionId);
    overview.value = value;
    scoreView.value = !!value.completedAt;
    ctx.actions().resetSources();
    if (value.notice) {
      message.value = value.notice;
    }
    if (value.initial.question) {
      await ctx.actions().show(value.initial.question);
    } else {
      ctx.actions().clearQuestion(true);
    }
  });
}

export async function initializeCatalog(ctx: PracticeSession) {
  await ctx.actions().catalog();
}
