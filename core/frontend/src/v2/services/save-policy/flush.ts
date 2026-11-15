import { beginRecovery, recovered, report } from './recovery.js';
import { clear } from './timers.js';
import type { Options, SaveState } from './types.js';

async function execute<T>(state: SaveState, options: Options<T>): Promise<void> {
  try {
    while (!state.disposed && (state.version > state.saved || state.pending || state.reloading)) {
      if (state.reloading) {
        await options.recovery!.reload(state.recoveryError);
        recovered(state, options);
        return;
      }
      if (!state.pending) {
        const captured = state.version,
          value = await options.read();
        if (state.disposed) {
          throw new Error('题目已关闭。');
        }
        state.pending = { version: captured, run: options.prepare(value) };
      }
      try {
        await state.pending.run();
      } catch (error) {
        if (!beginRecovery(state, options, error)) {
          throw error;
        }
        continue;
      }
      state.saved = state.pending.version;
      state.pending = null;
    }
    report(state, options, 'saved');
  } catch (error) {
    report(state, options, 'failed');
    throw error;
  } finally {
    state.running = null;
  }
}

export function flush<T>(state: SaveState, options: Options<T>): Promise<void> {
  if (state.running) {
    return state.running;
  }
  if (state.disposed) {
    return Promise.reject(new Error('题目已关闭。'));
  }
  if (state.version === state.saved && !state.pending && !state.reloading) {
    return Promise.resolve();
  }
  clear(state);
  options.status?.('saving');
  state.running = execute(state, options);
  return state.running;
}
