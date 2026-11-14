import { computed, ref, watch } from 'vue';
import { defineStore, storeToRefs } from 'pinia';
import { createApi } from '../api';
import { buildV2Outline } from '../services/outline';
import { useUiStore } from './ui';
import { useCatalogStore } from './catalog';
import { createRuntime } from './practice/runtime';
import { createActions } from './practice/actions';
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
  const session: PracticeSession = {
    ...uiRefs,
    ...state,
    api,
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
    ),
  );
  watch(
    () => state.overview.value?.completedAt,
    (value) => {
      ui.scoreView = !!value;
    },
  );
  return { ...state, outlineModel, ...actions };
});
