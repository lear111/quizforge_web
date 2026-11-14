import { createRouter, createWebHashHistory } from 'vue-router';
import type { Pinia } from 'pinia';
import WorkspaceView from '../views/WorkspaceView.vue';
import { usePracticeStore } from '../stores/practice';
import { useUiStore } from '../stores/ui';
import { workspaceRoutes } from './routes';
import { createWorkspaceNavigation } from './navigation';

export function createWorkspaceRouter(pinia: Pinia) {
  const router = createRouter({
    history: createWebHashHistory(),
    routes: workspaceRoutes(WorkspaceView),
  });
  const navigation = createWorkspaceNavigation(router, usePracticeStore(pinia), useUiStore(pinia));
  return { router, navigation };
}
