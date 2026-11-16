import { toRaw } from 'vue';
import type { PracticeSession } from '../../types/practice-session';
import type { Question } from '../../types/practice-types';

export async function historyList(ctx: PracticeSession) {
  const bankId = ctx.overview.value?.bank.bankId;
  return bankId ? ctx.api.history.list(bankId) : [];
}

export async function deleteHistory(ctx: PracticeSession, roundId: string) {
  const overview = ctx.overview.value;
  if (!overview || (overview.readOnly && overview.roundId === roundId)) {
    throw new Error('请先退出该轮历史回看，再删除。');
  }
  await ctx.api.history.remove(overview.bank.bankId, roundId);
}

function suspendPractice(ctx: PracticeSession) {
  if (ctx.overview.value && !ctx.overview.value.readOnly) {
    const question = ctx.current.value;
    ctx.runtime.returnPractice = {
      overview: ctx.overview.value,
      question: question
        ? { ...toRaw(question), ink: ctx.runtime.scratch?.getDraft() ?? question.ink }
        : null,
      scoreView: ctx.scoreView.value,
      drafting: ctx.drafting.value,
      message: ctx.message.value,
    };
  }
  ctx.actions().clearQuestion(true);
  ctx.actions().resetSources();
  ctx.runtime.grader?.dispose();
  ctx.runtime.completionGrader?.clear();
  ctx.drafting.value = false;
  ctx.runtime.scratch?.setMode(false);
}

export async function showHistoryQuestion(
  ctx: PracticeSession,
  id: string,
  initial?: Question | null,
) {
  const bank = ctx.overview.value!;
  bank.lastQuestionId = id;
  ctx.actions().clearQuestion(true);
  try {
    const question =
      initial ??
      (await ctx.api.questions.get({
        bankId: bank.bank.bankId,
        roundId: bank.roundId,
        questionId: id,
        snapshotId: bank.snapshotId,
      }));
    await ctx.actions().show(question, false);
  } catch (error) {
    ctx.actions().clearQuestion(true);
    ctx.message.value = `题型不可用：${error instanceof Error ? error.message : '无法加载归档题目。'}`;
  }
}

export async function openHistory(
  ctx: PracticeSession,
  bankId: string,
  roundId: string,
  questionId?: string,
) {
  await ctx.run('正在读取历史记录', async () => {
    await ctx.actions().flush();
    const overview = await ctx.api.history.overview(bankId, roundId);
    suspendPractice(ctx);
    ctx.overview.value = overview;
    ctx.message.value = '';
    ctx.scoreView.value = false;
    ctx.drawer.value = null;
    const id = questionId ?? overview.lastQuestionId;
    if (id) {
      await showHistoryQuestion(
        ctx,
        id,
        id === overview.initial.question?.questionId ? overview.initial.question : null,
      );
    }
  });
}

async function restorePractice(
  ctx: PracticeSession,
  value: NonNullable<PracticeSession['runtime']['returnPractice']>,
) {
  ctx.actions().clearQuestion(true);
  ctx.actions().resetSources();
  ctx.actions().initializeRuntime(ctx.runtime.nonce);
  ctx.overview.value = value.overview;
  ctx.scoreView.value = value.scoreView;
  ctx.message.value = value.message;
  if (value.question) {
    await ctx.actions().show(value.question, false);
  }
  ctx.drafting.value = value.drafting;
  ctx.runtime.scratch?.setMode(value.drafting);
}

export async function leaveHistory(ctx: PracticeSession) {
  if (!ctx.overview.value?.readOnly) {
    return;
  }
  const bankId = ctx.overview.value.bank.bankId;
  const previous = ctx.runtime.returnPractice;
  await ctx.run('正在返回当前练习', async () => {
    await ctx.actions().flush();
    await restorePractice(
      ctx,
      previous ?? {
        overview: null,
        question: null,
        scoreView: false,
        drafting: false,
        message: '',
      },
    );
    ctx.runtime.returnPractice = null;
  });
  if (!previous) {
    await ctx.actions().openBank(bankId);
  }
}
