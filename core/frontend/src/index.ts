import { createApp, h, render } from 'vue';
import AiChatPanel from './chat/AiChatPanel.vue';
import type { ChatRequest } from './chat/session';
import LibraryList from './library/LibraryList.vue';
import type { LibraryActions, LibraryTree } from './library/types';

// The host's synchronous catalog render contract is retained. Vue patches the
// existing keyed tree instead of replacing the list and losing focused controls.
export function renderLibrary({ container, ...props }: LibraryActions & { container: HTMLElement; groups: LibraryTree[]; emptyMessage: string }) {
  render(h(LibraryList, props), container);
}
export function unmountLibrary(container: HTMLElement) { render(null, container); }

export function mountAiChat({ container, request }: { container: HTMLElement; request: ChatRequest }) {
  const app = createApp(AiChatPanel, { request });
  const panel = app.mount(container) as unknown as { cancel(): void };
  let disposed = false;
  return {
    cancel() { if (!disposed) panel.cancel(); },
    destroy() { if (!disposed) { disposed = true; app.unmount(); } },
  };
}
