import NetworkPanel from './network/NetworkPanel.vue';
import DevelopmentPanel from './development/DevelopmentPanel.vue';
import { createDevelopmentSettings, type DevelopmentConfig, type DevelopmentHooks } from './development/settings';
import UserCenterPanel from './user-center/UserCenterPanel.vue';
import { createUserCenter, type UserConfig, type UserHooks } from './user-center/account';
import AiSettingsPanel from './ai/AiSettingsPanel.vue';
import { createAiSettings, type AiConfig, type AiFields } from './ai/settings';
import { createNetworkSettings, type NetworkConfig, type NetworkDraft, type NetworkFields } from './network/settings';
import { createApp, h, render } from 'vue';
import AppearancePanel from './appearance/AppearancePanel.vue';
import { createAppearanceSettings, type AppearanceConfig } from './appearance/settings';
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

export function mountDevelopmentSettings({ container, form, isOpen, show, close, ...config }: DevelopmentConfig & Pick<DevelopmentHooks, 'isOpen' | 'show' | 'close'> & { container: HTMLElement; form: HTMLFormElement }) {
  const manager = createDevelopmentSettings(config, {
    render(state) { form.setAttribute('aria-busy', String(state.busy)); render(h(DevelopmentPanel, { state, actions: manager }), container); },
    isOpen, show, close,
  });
  manager.initialize(); let disposed = false;
  return { open: manager.open, deactivate: manager.deactivate, destroy() { if (disposed) return; disposed = true; manager.destroy(); render(null, container); form.setAttribute('aria-busy', 'false'); } };
}

export function mountUserCenter({ container, panel, isOpen, show, close, openContact, closeContact, ...config }: UserConfig & Pick<UserHooks, 'isOpen' | 'show' | 'close' | 'openContact' | 'closeContact'> & { container: HTMLElement; panel: HTMLElement }) {
  let component: { readCode(): string; clearCode(): void } | null = null;
  const manager = createUserCenter(config, {
    render(state) {
      panel.setAttribute('aria-busy', String(state.busy));
      const vnode = h(UserCenterPanel, { state, actions: manager }); render(vnode, container); component = vnode.component?.exposed as typeof component;
    },
    readCode: () => component!.readCode(), clearCode: () => component?.clearCode(), isOpen, show, close, openContact, closeContact,
  });
  manager.initialize(); let disposed = false;
  return { open: manager.open, deactivate: manager.deactivate, destroy() { if (disposed) return; disposed = true; manager.destroy(); render(null, container); component = null; } };
}

export function mountAiSettings({ container, form, isOpen, show, close, ...config }: AiConfig & {
  container: HTMLElement; form: HTMLFormElement; isOpen(): boolean; show(): void; close(): void;
}) {
  let component: { readFields(): AiFields; readKey(): string; writeKey(key: string): void } | null = null;
  const manager = createAiSettings(config, {
    render(state) {
      form.setAttribute('aria-busy', String(state.busy));
      const vnode = h(AiSettingsPanel, { state, actions: manager }); render(vnode, container);
      component = vnode.component?.exposed as typeof component;
    },
    readFields: () => component!.readFields(), readKey: () => component!.readKey(), writeKey: key => component?.writeKey(key),
    isOpen, show, close,
  });
  manager.initialize();
  let disposed = false;
  return { open: manager.open, save: manager.save, deactivate: manager.deactivate,
    destroy() { if (disposed) return; disposed = true; manager.destroy(); render(null, container); component = null; } };
}

// Appearance content is Vue-owned; native settings tabs/dialog remain host-owned.
export function mountAppearanceSettings({ container, ...config }: AppearanceConfig & { container: HTMLElement }) {
  const manager = createAppearanceSettings(config, state => render(h(AppearancePanel, { state, themes: config.themes, actions: manager }), container));
  const ready = manager.initialize();
  return { ready, get value() { return manager.value; }, clearError: manager.clearError,
    destroy() { manager.destroy(); render(null, container); } };
}

// The host owns the stable native form/dialog, Vue owns only its contents.
export function mountNetworkSettings({ container, form, dialog, closeButton, copy, ...config }: NetworkConfig & {
  container: HTMLElement; form: HTMLFormElement; dialog: HTMLDialogElement; closeButton: HTMLButtonElement; copy(value: string): Promise<unknown>;
}) {
  let component: { readFields(): NetworkFields; readDraft(): NetworkDraft; clearPassword(): void; focus(target: string): void } | null = null;
  const manager = createNetworkSettings(config, {
    render(state) {
      form.setAttribute('aria-busy', String(state.loading || state.saving)); closeButton.disabled = state.saving;
      const vnode = h(NetworkPanel, { state, actions: manager, copy }); render(vnode, container);
      component = vnode.component?.exposed as typeof component;
    },
    readFields: () => component!.readFields(), readDraft: () => component!.readDraft(), clearPassword: () => component?.clearPassword(), focus: target => component?.focus(target),
    isOpen: () => dialog.open, show: () => dialog.showModal(), close: () => dialog.close(),
  });
  manager.initialize();
  let disposed = false;
  return { open: manager.open, refresh: manager.refresh, save: manager.save, close: manager.close, closed: manager.closed,
    get saving() { return manager.saving; }, destroy() { if (disposed) return; disposed = true; manager.destroy(); render(null, container); component = null; closeButton.disabled = false; } };
}
