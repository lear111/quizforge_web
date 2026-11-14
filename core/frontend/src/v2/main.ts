import { createApp } from 'vue';
import { createPinia, disposePinia } from 'pinia';
import App from './App.vue';

export function mountV2App(container: HTMLElement, nonce: string) {
  const pinia = createPinia();
  const app = createApp(App, { nonce });
  app.use(pinia);
  app.onUnmount(() => disposePinia(pinia));
  return app.mount(container);
}
