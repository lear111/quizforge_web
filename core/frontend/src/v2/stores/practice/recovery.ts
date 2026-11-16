import type { ApiErrorCode } from '../../../../../shared/v2/api.js';
import { isSaveConflict, saveRecoveryMessage } from '../../services/save-policy';
import type { Overview, Question } from '../../types/practice-types';
import type { PracticeSession } from '../../types/practice-session';

function isCurrent(ctx: PracticeSession, previous: Question) {
  return (
    ctx.current.value?.bankId === previous.bankId &&
    ctx.current.value.roundId === previous.roundId &&
    ctx.current.value.questionId === previous.questionId
  );
}

async function refreshedQuestion(ctx: PracticeSession, previous: Question, mine: number) {
  const { api, current, overview, message, token } = ctx;
  let value: Overview;
  try {
    value = previous.roundId
      ? await api.history.overview(previous.bankId, previous.roundId)
      : await api.banks.overview(previous.bankId);
  } catch (error) {
    if (!isSaveConflict(error)) {
      throw error;
    }
    ctx.actions().disposePage();
    current.value = null;
    overview.value = null;
    ctx.runtime.sources!.dispose();
    message.value = '本题或题库已移除，本地未保存内容已放弃，请选择其他题目。';
    return null;
  }
  if (mine !== ctx.runtime.generation) {
    return null;
  }
  overview.value = value;
  ctx.runtime.sources!.scope(previous.bankId, value.snapshotId, token.value);
  if (!value.states.some((state) => state.questionId === previous.questionId)) {
    if (isCurrent(ctx, previous)) {
      ctx.actions().disposePage();
      current.value = null;
    }
    message.value = '本题已移除，本地未保存内容已放弃，请选择其他题目。';
    return null;
  }
  try {
    return await api.questions.get({ ...previous, snapshotId: value.snapshotId });
  } catch (error) {
    if (!isSaveConflict(error)) {
      throw error;
    }
    if (isCurrent(ctx, previous)) {
      ctx.actions().disposePage();
      current.value = null;
    }
    message.value = '本题暂时不可用，本地未保存内容已放弃，请选择其他题目。';
    return null;
  }
}

async function latestQuestion(ctx: PracticeSession, previous: Question, mine: number) {
  try {
    return await ctx.api.questions.get(previous);
  } catch (error) {
    if (!isSaveConflict(error)) {
      throw error;
    }
    return refreshedQuestion(ctx, previous, mine);
  }
}

export async function reloadAfterConflict(
  ctx: PracticeSession,
  previous: Question,
  mine: number,
  error?: unknown,
): Promise<Question | null> {
  const { overview, recovering, message, api } = ctx;
  if (mine !== ctx.runtime.generation) {
    return null;
  }
  recovering.value = true;
  try {
    if (
      !previous.readOnly &&
      (error as { code?: string } | undefined)?.code === ('ROUND_COMPLETED' satisfies ApiErrorCode)
    ) {
      const value: Overview = await api.banks.overview(previous.bankId);
      if (mine !== ctx.runtime.generation) {
        return null;
      }
      overview.value = value;
    }
    const latest = await latestQuestion(ctx, previous, mine);
    if (!latest) {
      return null;
    }
    if (mine !== ctx.runtime.generation) {
      return null;
    }
    if (isCurrent(ctx, previous)) {
      if (
        latest.snapshotId === previous.snapshotId &&
        latest.extension.artifactId === previous.extension.artifactId
      ) {
        await ctx.actions().applyContext(latest);
        ctx.runtime.scratch?.load(latest.ink);
      } else {
        await ctx.actions().show(latest, false);
      }
    } else if (overview.value?.bank.bankId === latest.bankId) {
      overview.value.states = overview.value.states.map((state) =>
        state.questionId === latest.questionId ? latest.state : state,
      );
    }
    message.value = saveRecoveryMessage(error);
    return latest;
  } finally {
    recovering.value = false;
  }
}
