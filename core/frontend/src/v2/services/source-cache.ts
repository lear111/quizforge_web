import { loadSources } from './source-cache/sources';
import type { CacheState, Loaders } from './source-cache/types';

function clear(state: CacheState): void {
  state.epoch++;
  state.abort.abort();
  state.abort = new AbortController();
  state.pages.clear();
  state.sdks.clear();
}

function load(state: CacheState, loaders: Loaders, artifactId: string) {
  const cached = state.pages.get(artifactId);
  if (cached) {
    return cached;
  }
  const scope = { epoch: state.epoch, signal: state.abort.signal, snapshotId: state.snapshot };
  const promise = loadSources(state, loaders, artifactId, scope);
  state.pages.set(artifactId, promise);
  void promise.catch(() => {
    if (state.pages.get(artifactId) === promise) {
      state.pages.delete(artifactId);
    }
  });
  return promise;
}

export function createPageSourceCache(loaders: Loaders) {
  const state: CacheState = {
    key: '',
    snapshot: '',
    epoch: 0,
    abort: new AbortController(),
    pages: new Map(),
    sdks: new Map(),
  };
  return {
    scope(bankId: string, snapshotId: string, authorization: string) {
      const next = JSON.stringify([bankId, snapshotId, authorization]);
      if (next !== state.key) {
        clear(state);
        state.key = next;
        state.snapshot = snapshotId;
      }
    },
    load: (artifactId: string) => load(state, loaders, artifactId),
    dispose() {
      clear(state);
      state.key = '';
    },
  };
}
