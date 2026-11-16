import type { RouteLocationRaw, RouteLocationNormalized } from 'vue-router';
import type { usePracticeStore } from '../stores/practice';
import type { useUiStore } from '../stores/ui';

type Practice = ReturnType<typeof usePracticeStore>;
export async function loadHistoryLocation(
  to: RouteLocationNormalized,
  practice: Practice,
  ui: ReturnType<typeof useUiStore>,
) {
  const bankId = String(to.params.bankId);
  const roundId = String(to.params.roundId);
  const questionId = to.params.questionId ? String(to.params.questionId) : undefined;
  if (practice.overview?.roundId === roundId && practice.overview.bank.bankId === bankId) {
    if (questionId) {
      await practice.navigate(questionId);
    }
  } else {
    await practice.openHistory(bankId, roundId, questionId);
  }
  if (practice.overview?.roundId === roundId && practice.overview.bank.bankId === bankId) {
    ui.scoreView = to.name === 'history-summary';
    ui.drawer = null;
  }
}

export function historyLocation(
  practice: Practice,
  summary: boolean,
  questionId?: string,
): RouteLocationRaw | null {
  const bank = practice.overview;
  if (!bank?.readOnly || !bank.roundId) {
    return null;
  }
  return {
    name: summary ? 'history-summary' : 'history',
    params: {
      bankId: bank.bank.bankId,
      roundId: bank.roundId,
      ...(summary
        ? {}
        : { questionId: questionId ?? practice.current?.questionId ?? bank.lastQuestionId }),
    },
  };
}
