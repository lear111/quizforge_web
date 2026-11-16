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
  const examInProgress = Boolean(overview.value?.exam && !overview.value.completedAt);
  const canAct = !q.readOnly && !overview.value?.completedAt && !examInProgress;
  return {
    question: q.question,
    answer: q.answer,
    solution: examInProgress ? null : q.solution,
    result: examInProgress ? null : q.result,
    item: q.item,
    locked: q.readOnly || q.state.locked || (examInProgress && ctx.examExpired()),
    can: {
      submit: canAct && !q.state.locked,
      retry: canAct && q.state.hasSavedAnswer,
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
