import { toRaw } from 'vue';
import { saveGrade, recoverGrades } from '../services/scoring';
import { isSaveConflict } from '../services/save-policy';
import type { Overview, Question } from '../types/practice-types';
import type { PracticeSession } from '../types/practice-session';

export async function score(ctx: PracticeSession, q: Question): Promise<Question> {
  const { current, api } = ctx;
  // Browser postMessage cannot clone Vue proxies from the current-question ref.
  q = toRaw(q);
  try {
    return await saveGrade(
      {
        questionId: q.questionId,
        question: q.question,
        solution: q.solution,
        answer: q.answer,
        item: q.item,
      },
      (items) => ctx.runtime.grader!.grade(q.extension.artifactId, items),
      (result) =>
        ctx.runtime.queue.enqueue(async () => {
          const saved: Question = await api.questions.result(q, result);
          // Publish the new revision before releasing the shared write queue.
          if (
            current.value?.bankId === saved.bankId &&
            current.value.questionId === saved.questionId
          ) {
            ctx.actions().update(saved);
          }
          return saved;
        }),
    );
  } catch (error) {
    if (!isSaveConflict(error)) {
      throw error;
    }
    const latest = await ctx.actions().reloadAfterConflict(q, ctx.runtime.generation, error);
    if (!latest) {
      // Keep the existing public error shape when the conflicting question was removed.
      // eslint-disable-next-line preserve-caught-error
      throw new Error('本题已移除，已放弃过期评分。');
    }
    return latest;
  }
}

export async function grade(ctx: PracticeSession, q: Question) {
  const { current } = ctx;
  await ctx.actions().flush();
  const active = current.value;
  if (active?.bankId === q.bankId && active.questionId === q.questionId) {
    await ctx.actions().score(active);
    await ctx.actions().flush();
    if (current.value?.bankId === q.bankId && current.value.questionId === q.questionId) {
      await ctx.actions().applyContext(current.value);
    }
  }
}

export async function submit(ctx: PracticeSession) {
  const { overview, current, api } = ctx;
  if (
    !current.value ||
    !ctx.runtime.page ||
    current.value.state.locked ||
    overview.value?.completedAt
  ) {
    return;
  }
  await ctx.run('正在提交并评分', async () => {
    await ctx.actions().flush();
    const q = current.value;
    if (!q || q.state.locked) {
      return;
    }
    const answer = await ctx.runtime.page!.answer();
    let saved: Question;
    try {
      saved = await ctx.runtime.queue.enqueue(() => api.questions.submit(q, answer));
    } catch (error) {
      if (!isSaveConflict(error)) {
        throw error;
      }
      await ctx.actions().reloadAfterConflict(q, ctx.runtime.generation, error);
      return;
    }
    await ctx.actions().applyContext(saved);
    await ctx.actions().grade(saved);
  });
}

export async function retry(ctx: PracticeSession) {
  const { overview, current, api } = ctx;
  if (!current.value || overview.value?.completedAt) {
    return;
  }
  await ctx.run('正在重做', async () => {
    await ctx.actions().flush();
    const q = current.value!;
    try {
      const saved = await ctx.runtime.queue.enqueue(() => api.questions.retry(q));
      await ctx.actions().applyContext(saved);
      ctx.runtime.scratch?.load(saved.ink);
    } catch (error) {
      if (!isSaveConflict(error)) {
        throw error;
      }
      await ctx.actions().reloadAfterConflict(q, ctx.runtime.generation, error);
    }
  });
}

export async function recoverPending(ctx: PracticeSession, value: Overview) {
  const { overview, current, message } = ctx;
  if (value.completedAt) {
    try {
      await ctx.actions().gradeCompleted(value);
    } catch (error) {
      message.value = error instanceof Error ? error.message : '部分题目暂未完成评分，请稍后重试。';
    }
    return;
  }
  await recoverGrades(
    value.pendingGrading.flatMap((pending) => (pending.question ? [pending.question] : [])),
    ctx.actions().score,
    async (saved) => {
      overview.value!.states = overview.value!.states.map((s) =>
        s.questionId === saved.questionId ? saved.state : s,
      );
      if (saved.questionId === current.value?.questionId) {
        await ctx.actions().flush();
        if (current.value) {
          await ctx.actions().applyContext(current.value);
        }
      }
    },
    (error) => {
      message.value = error instanceof Error ? error.message : '部分题目暂未完成评分，请稍后重试。';
    },
  );
}

export function continueGrading(ctx: PracticeSession) {
  const { overview, current } = ctx;
  if (overview.value?.completedAt) {
    return ctx.actions().resumeCompletion();
  }
  if (current.value) {
    return ctx.run('正在评分', () => ctx.actions().grade(current.value!));
  }
}
