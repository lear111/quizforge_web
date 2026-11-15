import { clear, schedule } from './save-policy/timers.js';
import { flush } from './save-policy/flush.js';
import type { Options, SaveKind, SaveState } from './save-policy/types.js';
export type { SaveKind } from './save-policy/types.js';
export { SAVE_DELAYS } from './save-policy/timers.js';
export { isSaveConflict, saveRecoveryMessage } from './save-policy/conflicts.js';
export { attachSaveLifecycle } from './save-policy/lifecycle.js';

export function createSaveController<T>(options: Options<T>) {
  const state: SaveState = {
    clock: options.clock ?? window,
    version: 0,
    saved: 0,
    disposed: false,
    idle: undefined,
    deadline: undefined,
    pending: null,
    running: null,
    reloading: false,
    recoveryError: undefined,
  };
  const auto = () => {
    void flush(state, options).catch((error) => {
      if (!state.disposed) {
        options.error?.(error);
      }
    });
  };
  return {
    get dirty() {
      return state.version > state.saved || state.pending !== null || state.reloading;
    },
    changed(kind: SaveKind) {
      if (state.disposed) {
        return;
      }
      state.version++;
      options.status?.('unsaved');
      schedule(state, kind, auto);
    },
    flush: () => flush(state, options),
    destroy() {
      state.disposed = true;
      clear(state);
    },
  };
}
