import { isSaveConflict, saveRecoveryMessage } from '../services/save-policy';
import type { Overview, Question } from '../types/practice-types';
import type { PracticeSession } from '../types/practice-session';

export async function reloadAfterConflict(
  ctx: PracticeSession,
  previous: Question,
  mine: number,
  error?: unknown,
): Promise<Question | null> {
  const { overview, current, recovering, message, token, api } = ctx;
  if (mine !== ctx.runtime.generation) {
    return null;
  }
  const isCurrent = () =>
    current.value?.bankId === previous.bankId && current.value.questionId === previous.questionId;
  recovering.value = true;
  try {
    if ((error as { code?: string } | undefined)?.code === 'ROUND_COMPLETED') {
      const value: Overview = await api.banks.overview(previous.bankId);
      if (mine !== ctx.runtime.generation) {
        return null;
      }
      overview.value = value;
    }
    let latest: Question;
    try {
      latest = await api.questions.get(previous);
    } catch (error) {
      if (!isSaveConflict(error)) {
        throw error;
      }
      let value: Overview;
      try {
        value = await api.banks.overview(previous.bankId);
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
        if (isCurrent()) {
          ctx.actions().disposePage();
          current.value = null;
        }
        message.value = '本题已移除，本地未保存内容已放弃，请选择其他题目。';
        return null;
      }
      try {
        latest = await api.questions.get({ ...previous, snapshotId: value.snapshotId });
      } catch (error) {
        if (!isSaveConflict(error)) {
          throw error;
        }
        if (isCurrent()) {
          ctx.actions().disposePage();
          current.value = null;
        }
        message.value = '本题暂时不可用，本地未保存内容已放弃，请选择其他题目。';
        return null;
      }
    }
    if (mine !== ctx.runtime.generation) {
      return null;
    }
    if (isCurrent()) {
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
