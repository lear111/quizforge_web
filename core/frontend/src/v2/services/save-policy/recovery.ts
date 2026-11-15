import { clear } from './timers.js';
import type { Options, SaveState } from './types.js';

export function beginRecovery<T>(state: SaveState, options: Options<T>, error: unknown): boolean {
  if (!options.recovery?.accepts(error)) {
    return false;
  }
  // A rejected write cannot succeed. Retry only the reload; local input loses.
  state.pending = null;
  state.recoveryError = error;
  state.reloading = true;
  return true;
}

export function recovered<T>(state: SaveState, options: Options<T>): void {
  state.reloading = false;
  state.saved = state.version;
  clear(state);
  if (!state.disposed) {
    options.status?.('recovered');
  }
}

export function report<T>(state: SaveState, options: Options<T>, status: 'saved' | 'failed'): void {
  if (!state.disposed) {
    clear(state);
    options.status?.(status);
  }
}
