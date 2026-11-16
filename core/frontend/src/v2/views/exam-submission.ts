import { computed, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { usePracticeStore } from '../stores/practice';
import { useUiStore } from '../stores/ui';
import { useWorkspaceNavigation } from '../router/injection';

export function useExamSubmission() {
  const practice = usePracticeStore();
  const { overview, examRemaining, recovering } = storeToRefs(practice);
  const { busy } = storeToRefs(useUiStore());
  const navigation = useWorkspaceNavigation();
  const activeSnapshot = computed(() =>
    overview.value?.exam && !overview.value.completedAt ? overview.value.snapshotId : null,
  );
  let attemptedAutomatic: string | null = null;

  async function submitExam() {
    const snapshotId = activeSnapshot.value;
    if (!snapshotId || busy.value || recovering.value) {
      return;
    }
    if (examRemaining.value === 0) {
      attemptedAutomatic = snapshotId;
    } else if (!confirm('交卷后不能再修改答案，未作答题记 0 分。确定交卷吗？')) {
      return;
    }
    await practice.complete();
    if (overview.value?.snapshotId === snapshotId && overview.value.completedAt) {
      await navigation.showSummary();
    }
  }

  watch(
    [activeSnapshot, examRemaining, busy, recovering],
    ([snapshotId, remaining, pending, recovering]) => {
      if (!snapshotId) {
        attemptedAutomatic = null;
      } else if (remaining === 0 && !pending && !recovering && attemptedAutomatic !== snapshotId) {
        void submitExam();
      }
    },
    { immediate: true },
  );
  return { submitExam };
}
