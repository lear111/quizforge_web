import type { RouteComponent, RouteRecordRaw } from 'vue-router';

export function workspaceRoutes(component: RouteComponent): RouteRecordRaw[] {
  // The same component without a route key preserves the page/whiteboard
  // handles while the address changes, including visits to the score screen.
  return [
    { path: '/', name: 'library', component },
    { path: '/banks/:bankId', name: 'bank', component },
    { path: '/banks/:bankId/questions/:questionId?', name: 'practice', component },
    { path: '/banks/:bankId/summary', name: 'summary', component },
    { path: '/:pathMatch(.*)*', redirect: { name: 'library', params: {} } },
  ];
}
