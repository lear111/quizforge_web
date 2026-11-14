import { toRaw } from 'vue';
import type { Completion, Question } from '../../types/practice-types';
import type { PracticeSession } from '../../types/practice-session';

export function update(ctx: PracticeSession, q: Question, preserveStatus = false) {
  const { overview, current } = ctx;
  if (current.value?.bankId === q.bankId && current.value.questionId === q.questionId) {
    if (!Object.hasOwn(q, 'ink')) {
      q = { ...q, ink: current.value.ink, inkRevision: current.value.inkRevision };
    }
    if (preserveStatus) {
      q = { ...q, state: { ...q.state, status: current.value.state.status } };
    }
  }
  current.value = q;
  if (overview.value) {
    overview.value.states = overview.value.states.map((s) =>
      s.questionId === q.questionId ? q.state : s,
    );
  }
}

export function context(ctx: PracticeSession, question: Question) {
  const { overview } = ctx;
  const q = toRaw(question);
  return {
    question: q.question,
    answer: q.answer,
    solution: q.solution,
    result: q.result,
    item: q.item,
    locked: q.state.locked,
    can: {
      submit: !q.state.locked && !overview.value?.completedAt,
      retry: q.state.hasSavedAnswer && !overview.value?.completedAt,
    },
    appearance: { theme: 'light' as const },
  };
}

export function applyCompletion(ctx: PracticeSession, value: Completion) {
  const { overview, current } = ctx;
  if (!overview.value) {
    return;
  }
  Object.assign(overview.value, value);
  if (!value.pendingGrading) {
    overview.value.pendingGrading = overview.value.pendingGrading.filter((row) => !row.question);
  }
  if (current.value) {
    const state = value.states.find((state) => state.questionId === current.value!.questionId);
    if (state) {
      ctx.actions().update({ ...toRaw(current.value), state });
    }
  }
}
