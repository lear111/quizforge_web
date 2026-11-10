export type EditorCommand = 'save' | 'cancel' | 'choose' | 'return';
export interface EditorModel {
  hidden: boolean; editing: boolean; history: boolean; choose: boolean;
  busy: boolean; label: string;
}
export interface EditorSource {
  scope: object; model: EditorModel;
  isCurrent(): boolean;
  run(command: EditorCommand, isCurrent: () => boolean): Promise<unknown>;
}
export interface EditorHooks {
  render(model: EditorModel, message: string): void;
  isCurrent(): boolean; showNotice(): void; closeNotice(): void;
}
const empty: EditorModel = { hidden: true, editing: false, history: false, choose: false, busy: false, label: '' };

// Only display state enters Vue. The extension owns its authoring form, and
// the host owns flush, save, conflicts, cancellation and the transition queue.
export function createEditorUi(hooks: EditorHooks) {
  let source: EditorSource | undefined, pending = false, destroyed = false, epoch = 0, message = '';
  const alive = () => !destroyed && hooks.isCurrent();
  const publish = () => { if (!destroyed) hooks.render({ ...(source?.model || empty), busy: !!source?.model.busy || pending }, message); };
  function closeNotice() { message = ''; hooks.closeNotice(); publish(); }
  return {
    initialize: publish,
    update(next: EditorSource) {
      if (!alive()) return;
      if (source?.scope !== next.scope) { ++epoch; pending = false; closeNotice(); }
      source = next; publish();
    },
    async run(command: EditorCommand) {
      const captured = source, generation = epoch;
      const current = () => alive() && generation === epoch && source?.scope === captured?.scope && !!captured?.isCurrent();
      if (!captured || !current() || pending || captured.model.busy || captured.model.hidden) return;
      if ((command === 'save' || command === 'cancel') ? !captured.model.editing : !captured.model.history || (command === 'choose' && !captured.model.choose)) return;
      pending = true; publish();
      // Errors are reported by the existing host transition, once.
      try { await captured.run(command, current); } catch { /* Preserve the host's error and original form. */ }
      finally { if (current()) { pending = false; publish(); } }
    },
    notice(text: string) { if (!alive()) return; message = text; publish(); hooks.showNotice(); },
    closeNotice,
    closed() { if (!destroyed) { message = ''; publish(); } },
    destroy() { if (destroyed) return; destroyed = true; ++epoch; hooks.closeNotice(); source = undefined; },
  };
}
