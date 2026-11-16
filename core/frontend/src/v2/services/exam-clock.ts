import { onScopeDispose, ref, watch, type Ref } from 'vue';
import type { Overview } from '../types/practice-types';

export function createExamClock(overview: Ref<Overview | null>) {
  const remaining = ref<number | null>(null);
  let deadline: number | null = null;
  // History temporarily hides the active round and later restores its overview.
  // Reusing that same server sample must not reset the countdown.
  const deadlines = new WeakMap<NonNullable<Overview['exam']>, number>();
  let timer: ReturnType<typeof setInterval> | undefined;
  const milliseconds = () => (deadline === null ? null : Math.max(0, deadline - performance.now()));
  const expired = () => milliseconds() === 0;
  function stop() {
    clearInterval(timer);
    timer = undefined;
  }
  watch(
    () => [overview.value?.exam, overview.value?.completedAt] as const,
    ([exam, completedAt]) => {
      stop();
      // The wall clock belongs to the server. Once calibrated, wall clock
      // changes on this device must not affect the remaining time.
      deadline = null;
      if (exam && !completedAt) {
        deadline =
          deadlines.get(exam) ??
          performance.now() + (Date.parse(exam.endsAt) - Date.parse(exam.now));
        deadlines.set(exam, deadline);
      }
      remaining.value = milliseconds();
      if (remaining.value && remaining.value > 0) {
        timer = setInterval(() => {
          remaining.value = milliseconds();
          if (expired()) {
            stop();
          }
        }, 250);
      }
    },
    { flush: 'sync', immediate: true },
  );
  onScopeDispose(stop);
  return { remaining, expired };
}
