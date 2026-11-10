export interface SaveStatus { readonly text: string; readonly type: string }
export interface LifecycleHooks {
  start(): void;
  finish(): void;
  error(error: unknown): void;
  status(value: SaveStatus): void;
}

// Host operations keep their existing saving and error semantics. Disposal
// prevents queued work and UI callbacks, not an already accepted server write.
export function createPracticeLifecycle(hooks: LifecycleHooks) {
  let tail: Promise<unknown> = Promise.resolve(), destroyed = false;
  let status: SaveStatus = Object.freeze({ text: '', type: '' });
  const busyOwners = new Set<object>(), writes = new Set<object>();
  return {
    transition<T>(work: () => T | Promise<T>): Promise<T | undefined> {
      if (destroyed) return Promise.resolve(undefined);
      const run = tail.then(async () => {
        if (destroyed) return undefined;
        hooks.start();
        try { return await work(); }
        finally { if (!destroyed) hooks.finish(); }
      });
      tail = run.catch(() => {});
      // Keep the rejected promise for callers while the queue itself recovers.
      void run.catch(error => { if (!destroyed) hooks.error(error); });
      return run;
    },
    settled() { return tail; },
    setWriteBusy(owner: object, busy: boolean) {
      if (!busy) busyOwners.delete(owner);
      else if (!destroyed) busyOwners.add(owner);
    },
    beginWrite() {
      const token = {};
      if (!destroyed) writes.add(token);
      // Deleting the same token twice cannot acknowledge another write.
      return () => { writes.delete(token); };
    },
    get pendingWrites() { return busyOwners.size + writes.size; },
    setSaveStatus(text: string, type = '') {
      if (destroyed) return;
      status = Object.freeze({ text, type }); hooks.status(status);
    },
    get saveStatus() { return status; },
    destroy() { destroyed = true; },
  };
}
