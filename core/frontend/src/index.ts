import { createApp } from 'vue';
import AiChatPanel from './chat/AiChatPanel.vue';
import type { ChatRequest } from './chat/session';

export function mountAiChat({ container, request }: { container: HTMLElement; request: ChatRequest }) {
  const app = createApp(AiChatPanel, { request });
  const panel = app.mount(container) as unknown as { cancel(): void };
  let disposed = false;
  return {
    cancel() { if (!disposed) panel.cancel(); },
    destroy() { if (!disposed) { disposed = true; app.unmount(); } },
  };
}
