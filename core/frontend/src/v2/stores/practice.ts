import { computed, ref } from 'vue';
import { defineStore, storeToRefs } from 'pinia';
import { createExamClock } from '../services/exam-clock';
import { createApi } from '../api';
import { buildV2Outline } from '../services/outline';
import { useUiStore } from './ui';
import { useCatalogStore } from './catalog';
import { createRuntime } from './practice/runtime';
import { createActions, viewActions } from './practice/actions';
import type { Overview, Question } from '../types/practice-types';
import type { PracticeSession } from '../types/practice-session';

export const usePracticeStore = defineStore('v2-practice', () => {
  const ui = useUiStore();
  const uiRefs = storeToRefs(ui);
  const state = {
    overview: ref<Overview | null>(null),
    current: ref<Question | null>(null),
    typeName: ref('题目'),
    saveStatus: ref(''),
    recovering: ref(false),
    drafting: ref(false),
    lastQuestions: ref(new Map<string, string>()),
  };
  const api = createApi({
    token: () => ui.token,
    unauthorized() {
      ui.authRequired = true;
      actions.resetSources();
    },
  });
  const examClock = createExamClock(state.overview);
  const session: PracticeSession = {
    ...uiRefs,
    ...state,
    api,
    examExpired: examClock.expired,
    run: ui.run,
    catalogStore: useCatalogStore(),
    runtime: createRuntime(),
    actions: () => actions,
  };
  const actions = createActions(session);
  const outlineModel = computed(() =>
    buildV2Outline(
      state.overview.value?.outline ?? [],
      state.overview.value?.states ?? [],
      ui.scoreView ? undefined : state.current.value?.questionId,
      Boolean(state.overview.value?.exam && !state.overview.value.completedAt),
    ),
  );
  return { ...state, outlineModel, examRemaining: examClock.remaining, ...viewActions(actions) };
});
