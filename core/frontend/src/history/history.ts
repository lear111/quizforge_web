export interface HistoryRow {
  id: string; title: string; exam: boolean; progress: string; score: string;
  deleteLabel: string; detail: string;
}
export interface HistorySource {
  owner: object; title: string; rows: HistoryRow[];
  open(id: string): unknown;
  remove(id: string): unknown;
}
export interface HistoryState {
  title: string; rows: HistoryRow[]; busy: boolean; error: string; detail: string;
}
export interface HistoryHooks {
  render(state: HistoryState): void;
  isCurrent(): boolean; isOpen(): boolean;
  show(): void; close(): void; showConfirmation(): void; closeConfirmation(): void;
  focus(): void;
}

// Commands and their owner stay outside Vue. Only these small display rows are
// rendered; no frozen question, answer, pane or drawing enters reactive state.
export function createHistoryList(hooks: HistoryHooks) {
  let source: HistorySource | undefined, busy = false, error = '', detail = '';
  let destroyed = false, epoch = 0, decision: ((accepted: boolean) => void) | null = null;
  const alive = () => !destroyed && hooks.isCurrent();
  const valid = (captured: number) => alive() && epoch === captured;
  const publish = () => { if (!destroyed) hooks.render({ title: source?.title || '历史记录', rows: source?.rows.map(row => ({ ...row })) || [], busy, error, detail }); };
  function decide(accepted: boolean) {
    const resolve = decision; decision = null; detail = '';
    hooks.closeConfirmation(); resolve?.(accepted); publish();
  }
  return {
    initialize: publish,
    update(next: HistorySource, clearError = false) {
      if (destroyed) return;
      if (source?.owner !== next.owner) { ++epoch; decide(false); busy = false; error = ''; }
      source = next; if (clearError) error = ''; publish();
    },
    show() { if (alive() && !busy) { ++epoch; hooks.show(); } },
    error(message = '') { if (!destroyed) { error = message; publish(); } },
    get busy() { return busy; },
    close() { if (alive() && !busy) hooks.close(); },
    closed() { if (destroyed) return; ++epoch; decide(false); busy = false; publish(); },
    decide,
    async open(id: string) {
      if (!alive() || !hooks.isOpen() || busy || !source?.rows.some(row => row.id === id)) return;
      const current = source; hooks.close();
      // The host transition reports opening failures and keeps the old page.
      try { await current.open(id); } catch { /* Host owns navigation errors. */ }
    },
    async remove(id: string) {
      if (!alive() || !hooks.isOpen() || busy) return;
      const current = source, row = current?.rows.find(row => row.id === id);
      if (!current || !row) return;
      const captured = epoch; busy = true; error = ''; detail = row.detail;
      try {
        const pending = new Promise<boolean>(resolve => { decision = resolve; });
        publish(); hooks.showConfirmation();
        if (!await pending || !valid(captured)) return;
        await current.remove(id);
      } catch (cause) {
        if (valid(captured)) {
          const failure = cause as { code?: unknown; message?: unknown } | null;
          error = failure?.code === 'REQUEST_TIMEOUT' ? '连接超时，请重新打开历史列表确认是否已删除。' : `删除失败：${failure?.message || String(cause)}`;
        }
      } finally {
        if (valid(captured)) { decision = null; detail = ''; busy = false; publish(); hooks.focus(); }
      }
    },
    destroy() { if (destroyed) return; destroyed = true; ++epoch; decide(false); hooks.close(); },
  };
}
