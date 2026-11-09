import { createApp, h, render } from 'vue';
import AiChatPanel from './chat/AiChatPanel.vue';
import type { ChatRequest } from './chat/session';
import LibraryList from './library/LibraryList.vue';
import type { LibraryActions, LibraryTree } from './library/types';
import LibraryManageForm from './library/LibraryManageForm.vue';
import { createLibraryManagement, type ManagementConfig } from './library/management';

// The native dialog retains top-layer/modal behavior. Vue owns only its form.
// Synchronous patches preserve the legacy open/focus/submit integration contract.
export function mountLibraryManagement({ container, dialog, ...config }: ManagementConfig & { container: HTMLElement; dialog: HTMLDialogElement }) {
  let component: { focus(target: 'name' | 'cancel'): void } | null = null;
  const manager = createLibraryManagement(config, {
    render(state) {
      const vnode = h(LibraryManageForm, { state, actions: manager });
      render(vnode, container);
      component = vnode.component?.exposed as typeof component;
    },
    show(target) { if (!dialog.open) dialog.showModal(); component?.focus(target); },
    close() { dialog.close(); },
  });
  const onCancel = (event: Event) => { event.preventDefault(); manager.cancel(); };
  // Native close events are queued: an immediate reopen must keep its operation.
  const onClose = () => { if (!dialog.open) manager.closed(); };
  dialog.addEventListener('cancel', onCancel); dialog.addEventListener('close', onClose);
  let disposed = false;
  const vnode = h(LibraryManageForm, { state: { ...manager.state }, actions: manager });
  render(vnode, container); component = vnode.component?.exposed as typeof component;
  return { open: manager.open, destroy() {
    if (disposed) return; disposed = true; manager.destroy();
    dialog.removeEventListener('cancel', onCancel); dialog.removeEventListener('close', onClose);
    if (dialog.open) dialog.close(); render(null, container); component = null;
  } };
}

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
