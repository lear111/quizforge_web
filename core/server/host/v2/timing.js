import { AsyncLocalStorage } from 'node:async_hooks';
import { performance } from 'node:perf_hooks';

// V2 diagnostics are independent of V1's fixed timing taxonomy. Nested work
// pauses its parent's counter, so serialization/write are not also validation.
const request = new AsyncLocalStorage();
export function withSaveTiming(enabled, action) {
  const clock = () => performance.now(), started = clock();
  return request.run(enabled ? { clock, started, last: started, phase: 'other', sealed: false,
    values: { parse: 0, validate: 0, serialize: 0, write: 0, other: 0 } } : null, action);
}
function switchTo(state, phase) {
  const now = state.clock(); state.values[state.phase] += now - state.last; state.last = now; state.phase = phase;
}
export function measureSave(phase, action) {
  const state = request.getStore();
  if (!state || state.sealed) return action();
  const previous = state.phase; switchTo(state, phase);
  try { return action(); } finally { switchTo(state, previous); }
}
export function saveTimingHeader() {
  const state = request.getStore();
  if (!state || state.sealed) return null;
  switchTo(state, 'other'); state.sealed = true;
  return Object.entries({ ...state.values, total: state.last - state.started }).map(([key, value]) => `${key};dur=${value.toFixed(3)}`).join(', ');
}
