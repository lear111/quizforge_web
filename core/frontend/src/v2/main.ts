import { createApp } from 'vue';
import { createPinia, disposePinia } from 'pinia';
import App from './App.vue';
import { createWorkspaceRouter } from './router';
import { workspaceNavigationKey } from './router/injection';

export function mountV2App(container: HTMLElement, nonce: string) {
  const pinia = createPinia();
  const app = createApp(App, { nonce });
  app.use(pinia);
  const { router, navigation } = createWorkspaceRouter(pinia);
  app.provide(workspaceNavigationKey, navigation);
  app.use(router);
  app.onUnmount(() => {
    navigation.dispose();
    disposePinia(pinia);
  });
  return app.mount(container);
}
