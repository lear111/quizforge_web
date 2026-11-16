import { ref, type Ref } from 'vue';
import type { HistoryRoundSummary } from '../../../../shared/v2/api.js';
import type { PracticeViewActions } from '../types/practice-session';

export function useHistoryDeletion(
  practice: Pick<PracticeViewActions, 'deleteHistory'>,
  rounds: Ref<HistoryRoundSummary[]>,
  generation: () => number,
) {
  const deleting = ref(false);
  const deleteError = ref('');

  async function remove(roundId: string) {
    if (deleting.value) {
      return;
    }
    const mine = generation();
    deleting.value = true;
    deleteError.value = '';
    try {
      await practice.deleteHistory(roundId);
      if (mine === generation()) {
        rounds.value = rounds.value.filter((round) => round.roundId !== roundId);
      }
    } catch (error) {
      if (mine === generation()) {
        deleteError.value = error instanceof Error ? error.message : '历史记录未能删除，请重试。';
      }
    } finally {
      deleting.value = false;
    }
  }

  return { deleting, deleteError, remove };
}
