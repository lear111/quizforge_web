import type { SaveKind, SaveState } from './types.js';
export const SAVE_DELAYS = Object.freeze({ choice: 0, text: 1000, ink: 1500, maxWait: 10000 });

export function clear(state: SaveState): void {
  if (state.idle !== undefined) {
    state.clock.clearTimeout(state.idle);
  }
  if (state.deadline !== undefined) {
    state.clock.clearTimeout(state.deadline);
  }
  state.idle = state.deadline = undefined;
}

export function schedule(state: SaveState, kind: SaveKind, auto: () => void): void {
  if (state.idle !== undefined) {
    state.clock.clearTimeout(state.idle);
  }
  state.idle = state.clock.setTimeout(auto, SAVE_DELAYS[kind]);
  state.deadline ??= state.clock.setTimeout(auto, SAVE_DELAYS.maxWait);
}
