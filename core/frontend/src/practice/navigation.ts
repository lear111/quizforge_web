export interface NavigationContext {
  owner: object; scope: string; ids: string[]; index: number; summaryAvailable: boolean;
}
export interface NavigationConfig {
  read(): NavigationContext | null;
  enqueue(work: () => Promise<void>): Promise<unknown>;
  question(owner: object, id: string): Promise<unknown>;
  jump(owner: object, id: string, itemId: string | null): Promise<unknown>;
  summary(owner: object): Promise<unknown>;
}
interface ScopedContext extends NavigationContext { generation: number }
interface StepBatch { owner: object; scope: string; generation: number; offset: number; promise?: Promise<unknown> }

// The host remains responsible for flushing, unsaved edits, actual rendering
// and error reporting. This controller only owns navigation intent and scope.
export function createPracticeNavigation(config: NavigationConfig) {
  let destroyed = false, pending: StepBatch | null = null;
  let observed: { owner: object; scope: string } | null = null, generation = 0;
  function sync(): ScopedContext | null {
    const value = destroyed ? null : config.read();
    if (value?.owner !== observed?.owner || value?.scope !== observed?.scope) {
      ++generation; observed = value ? { owner: value.owner, scope: value.scope } : null;
    }
    return value ? { ...value, generation } : null;
  }
  const current = (captured: { owner: object; scope: string; generation: number }) => {
    const value = sync();
    return value?.owner === captured.owner && value.scope === captured.scope && value.generation === captured.generation ? value : null;
  };
  function targeted(owner: object, run: () => Promise<unknown>) {
    const context = sync();
    if (!context || context.owner !== owner) return Promise.resolve();
    return config.enqueue(async () => { if (current(context)) await run(); });
  }
  return {
    sync,
    step(offset: number): Promise<unknown> {
      if (destroyed) return Promise.resolve();
      if (!Number.isInteger(offset) || !offset) return pending?.promise || Promise.resolve();
      const context = sync(); if (!context) return Promise.resolve();
      if (pending && pending.owner === context.owner && pending.scope === context.scope && pending.generation === context.generation) {
        pending.offset += offset; return pending.promise!;
      }
      const batch: StepBatch = { owner: context.owner, scope: context.scope, generation: context.generation, offset }; pending = batch;
      try {
        batch.promise = config.enqueue(async () => {
          if (pending === batch) pending = null;
          const value = current(batch); if (!value || !batch.offset || value.index < 0 || !value.ids.length) return;
          const last = value.summaryAvailable ? value.ids.length : value.ids.length - 1;
          const index = Math.max(0, Math.min(last, value.index + batch.offset));
          if (index === value.index) return;
          if (index === value.ids.length) await config.summary(value.owner);
          else await config.question(value.owner, value.ids[index]);
        });
        // Keep the original queue promise for callers; this handler only clears
        // a batch if an injected queue rejects before it invokes the work.
        void batch.promise.catch(() => { if (pending === batch) pending = null; });
        return batch.promise;
      } catch (error) { if (pending === batch) pending = null; throw error; }
    },
    jump(owner: object, id: string, itemId: string | null) { return targeted(owner, () => config.jump(owner, id, itemId)); },
    summary(owner: object) { return targeted(owner, () => config.summary(owner)); },
    destroy() { destroyed = true; pending = null; },
  };
}
