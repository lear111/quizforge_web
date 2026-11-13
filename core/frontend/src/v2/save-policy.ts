export const SAVE_DELAYS = Object.freeze({ choice: 0, text: 1000, ink: 1500, maxWait: 10000 });
export type SaveKind = 'choice' | 'text' | 'ink';
interface Clock { setTimeout(callback: () => void, ms: number): number; clearTimeout(id: number): void }
interface Options<T> {
  read(): Promise<T>;
  /** Freeze the request ID, body and expected revision once, including retries. */
  prepare(value: T): () => Promise<void>;
  clock?: Clock;
  status?(value: 'unsaved' | 'saving' | 'saved' | 'failed'): void;
  error?(error: unknown): void;
}
export function createSaveController<T>(options: Options<T>) {
  const clock = options.clock ?? window;
  let version = 0, saved = 0, disposed = false, idle: number | undefined, deadline: number | undefined;
  let pending: { version: number; run(): Promise<void> } | null = null, running: Promise<void> | null = null;
  const clear = () => { if (idle !== undefined) clock.clearTimeout(idle); if (deadline !== undefined) clock.clearTimeout(deadline); idle = deadline = undefined; };
  const auto = () => { void flush().catch(error => { if (!disposed) options.error?.(error); }); };
  function flush(): Promise<void> {
    if (running) return running;
    if (disposed) return Promise.reject(new Error('题目已关闭。'));
    if (version === saved && !pending) return Promise.resolve();
    clear(); options.status?.('saving');
    running = (async () => {
      try {
        while (!disposed && (version > saved || pending)) {
          if (!pending) { const captured = version, value = await options.read(); if (disposed) throw new Error('题目已关闭。'); pending = { version: captured, run: options.prepare(value) }; }
          await pending.run(); saved = pending.version; pending = null;
        }
        if (!disposed) { clear(); options.status?.('saved'); }
      } catch (error) { if (!disposed) { clear(); options.status?.('failed'); } throw error; }
      finally { running = null; }
    })();
    return running;
  }
  return {
    get dirty() { return version > saved || pending !== null; },
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
