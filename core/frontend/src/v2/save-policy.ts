export const SAVE_DELAYS = Object.freeze({ choice: 0, text: 1000, ink: 1500, maxWait: 10000 });
export type SaveKind = 'choice' | 'text' | 'ink';
export function isSaveConflict(error: unknown): boolean {
  const value = error as { status?: number; code?: string } | null;
  if (!value) return false;
  if (value.status !== undefined && value.status >= 400 && value.status < 500) return value.status !== 401;
  if (value.status !== undefined && value.status >= 500 || value.code === 'STATE_WRITE_FAILED') return false;
  return ['REVISION_CONFLICT', 'RESULT_CONFLICT', 'SUBMISSION_STALE', 'ANSWER_LOCKED', 'SNAPSHOT_STALE', 'BANK_NOT_OPEN', 'BANK_NOT_FOUND', 'QUESTION_NOT_FOUND'].includes(value.code ?? '');
}
export const saveRecoveryMessage = (error: unknown) => (error as { status?: number; code?: string } | null)?.status === 413 || (error as { code?: string } | null)?.code === 'STATE_SIZE_LIMIT'
  ? '作答文件已达上限，本次输入未保存，已载入最新内容。' : '本题已在别处修改，已载入最新内容';
interface Clock { setTimeout(callback: () => void, ms: number): number; clearTimeout(id: number): void }
interface Options<T> {
  read(): Promise<T>;
  /** Freeze the request ID, body and expected revision once, including retries. */
  prepare(value: T): () => Promise<void>;
  recovery?: { accepts(error: unknown): boolean; reload(error: unknown): Promise<void> };
  clock?: Clock;
  status?(value: 'unsaved' | 'saving' | 'saved' | 'failed' | 'recovered'): void;
  error?(error: unknown): void;
}
export function createSaveController<T>(options: Options<T>) {
  const clock = options.clock ?? window;
  let version = 0, saved = 0, disposed = false, idle: number | undefined, deadline: number | undefined;
  let pending: { version: number; run(): Promise<void> } | null = null, running: Promise<void> | null = null;
  let reloading = false;
  let recoveryError: unknown;
  const clear = () => { if (idle !== undefined) clock.clearTimeout(idle); if (deadline !== undefined) clock.clearTimeout(deadline); idle = deadline = undefined; };
  const auto = () => { void flush().catch(error => { if (!disposed) options.error?.(error); }); };
  function flush(): Promise<void> {
    if (running) return running;
    if (disposed) return Promise.reject(new Error('题目已关闭。'));
    if (version === saved && !pending && !reloading) return Promise.resolve();
    clear(); options.status?.('saving');
    running = (async () => {
      try {
        while (!disposed && (version > saved || pending || reloading)) {
          if (reloading) {
            await options.recovery!.reload(recoveryError);
            reloading = false; saved = version; clear();
            if (!disposed) options.status?.('recovered');
            return;
          }
          if (!pending) { const captured = version, value = await options.read(); if (disposed) throw new Error('题目已关闭。'); pending = { version: captured, run: options.prepare(value) }; }
          try { await pending.run(); }
          catch (error) {
            if (!options.recovery?.accepts(error)) throw error;
            // The old request can never succeed. A failed reload retries only
            // the read, not this stale write; all local input loses to the winner.
            pending = null; recoveryError = error; reloading = true; continue;
          }
          saved = pending.version; pending = null;
        }
        if (!disposed) { clear(); options.status?.('saved'); }
      } catch (error) { if (!disposed) { clear(); options.status?.('failed'); } throw error; }
      finally { running = null; }
    })();
    return running;
  }
  return {
    get dirty() { return version > saved || pending !== null || reloading; },
    changed(kind: SaveKind) {
      if (disposed) return;
      version++; options.status?.('unsaved');
      if (idle !== undefined) clock.clearTimeout(idle);
      idle = clock.setTimeout(auto, SAVE_DELAYS[kind]);
      deadline ??= clock.setTimeout(auto, SAVE_DELAYS.maxWait);
    },
    flush,
    destroy() { disposed = true; clear(); }
  };
}
export function attachSaveLifecycle(view: Window, saver: { readonly dirty: boolean; flush(): Promise<void> }) {
  const unload = (event: BeforeUnloadEvent) => { if (saver.dirty) { event.preventDefault(); event.returnValue = ''; } };
  const visibility = () => { if (view.document.visibilityState === 'hidden' && saver.dirty) void saver.flush().catch(() => {}); };
  view.addEventListener('beforeunload', unload); view.document.addEventListener('visibilitychange', visibility);
  return () => { view.removeEventListener('beforeunload', unload); view.document.removeEventListener('visibilitychange', visibility); };
}
