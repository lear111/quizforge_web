import EditorModeBar from './editor/EditorModeBar.vue';
import EditorLeaveNotice from './editor/EditorLeaveNotice.vue';
import { createEditorUi } from './editor/editor';
import HistoryPanel from './history/HistoryPanel.vue';
import HistoryConfirmation from './history/HistoryConfirmation.vue';
import { createHistoryList } from './history/history';
import PracticeSummary from './practice-summary/PracticeSummary.vue';
import { createPracticeSummary, type SummaryConfig } from './practice-summary/summary';
import NetworkPanel from './network/NetworkPanel.vue';
export { createPracticeNavigation } from './practice/navigation';
export { createPracticeLifecycle } from './practice/lifecycle';
import OutlinePanel from './outline/OutlinePanel.vue';
import { buildOutlineModel, type OutlineInput } from './outline/model';
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

export function renderOutline({ container, identity, input, onNavigate, onSummary }: {
  container: HTMLElement; identity: symbol; input: OutlineInput;
  onNavigate(questionId: string, itemId: string | null): unknown; onSummary(): unknown;
}) {
  render(h(OutlinePanel, { key: identity, model: buildOutlineModel(input), onNavigate, onSummary }), container);
}
export function unmountOutline(container: HTMLElement) { render(null, container); }

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


export function mountPracticeSummary({ container, ...config }: SummaryConfig & { container: HTMLElement }) {
  const manager = createPracticeSummary(config, model => render(h(PracticeSummary, { model, finish: manager.finish }), container));
  manager.initialize(); let destroyed = false;
  return { update: manager.update, destroy() { if (destroyed) return; destroyed = true; manager.destroy(); render(null, container); } };
}

export function mountHistoryList({ container, confirmationContainer, dialog, confirmation, isCurrent }: {
  container: HTMLElement; confirmationContainer: HTMLElement; dialog: HTMLDialogElement; confirmation: HTMLDialogElement; isCurrent(): boolean;
}) {
  const manager = createHistoryList({
    render(state) { render(h(HistoryPanel, { state, actions: manager }), container); render(h(HistoryConfirmation, { detail: state.detail, decide: manager.decide }), confirmationContainer); },
    isCurrent, isOpen: () => dialog.open,
    show: () => { if (!dialog.open) dialog.showModal(); }, close: () => { if (dialog.open) dialog.close(); },
    showConfirmation: () => confirmation.showModal(), closeConfirmation: () => { if (confirmation.open) confirmation.close(); },
    focus: () => { if (dialog.open) (container.querySelector<HTMLElement>('.history-row, .history-delete') || container.querySelector<HTMLElement>('#history-close'))?.focus(); },
  });
  const cancel = (event: Event) => { if (manager.busy) event.preventDefault(); };
  const closed = () => { if (!dialog.open) manager.closed(); };
  const cancelConfirmation = (event: Event) => { event.preventDefault(); manager.decide(false); };
  const closedConfirmation = () => { if (!confirmation.open) manager.decide(false); };
  dialog.addEventListener('cancel', cancel); dialog.addEventListener('close', closed);
  confirmation.addEventListener('cancel', cancelConfirmation); confirmation.addEventListener('close', closedConfirmation);
  manager.initialize(); let destroyed = false;
  return { update: manager.update, error: manager.error, show: manager.show, get busy() { return manager.busy; },
    destroy() {
      if (destroyed) return; destroyed = true;
      dialog.removeEventListener('cancel', cancel); dialog.removeEventListener('close', closed);
      confirmation.removeEventListener('cancel', cancelConfirmation); confirmation.removeEventListener('close', closedConfirmation);
      manager.destroy(); render(null, container); render(null, confirmationContainer);
    } };
}

export function mountEditorUi({ container, noticeContainer, dialog, isCurrent }: {
  container: HTMLElement; noticeContainer: HTMLElement; dialog: HTMLDialogElement; isCurrent(): boolean;
}) {
  const manager = createEditorUi({
    isCurrent,
    render(model, message) {
      container.hidden = model.hidden;
      render(h(EditorModeBar, { model, run: manager.run }), container);
      render(h(EditorLeaveNotice, { message, close: manager.closeNotice }), noticeContainer);
    },
    showNotice: () => { if (!dialog.open) dialog.showModal(); }, closeNotice: () => { if (dialog.open) dialog.close(); },
  });
  const closed = () => { if (!dialog.open) manager.closed(); };
  dialog.addEventListener('close', closed); manager.initialize(); let destroyed = false;
  return { update: manager.update, notice: manager.notice, destroy() {
    if (destroyed) return; destroyed = true; dialog.removeEventListener('close', closed); manager.destroy();
    render(null, container); render(null, noticeContainer); container.hidden = true;
  } };
}
