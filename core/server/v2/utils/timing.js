import { AsyncLocalStorage } from 'node:async_hooks';
import { performance } from 'node:perf_hooks';

// V2 diagnostics are independent of V1's fixed timing taxonomy. Nested work
// pauses its parent's counter, so serialization/write are not also validation.
const request = new AsyncLocalStorage();
const savePhases = { parse: 0, validate: 0, serialize: 0, write: 0, other: 0 };
const overviewPhases = {
  'locate-bank': 0,
  'bank-tree': 0,
  'bank-json': 0,
  'extension-scan': 0,
  'extension-resolve': 0,
  'sdk-digest': 0,
  'snapshot-id': 0,
  'content-fingerprint': 0,
  'state-check': 0,
  'ink-index': 0,
  'ink-body': 0,
  assemble: 0,
  serialize: 0,
  other: 0,
};
function withTiming(enabled, kind, template, action) {
  if (!enabled) {
    return request.run(null, action);
  }
  const clock = () => performance.now(),
    started = clock();
  return request.run(
    { kind, clock, started, last: started, phase: 'other', sealed: false, values: { ...template } },
    action,
  );
}
export const withSaveTiming = (enabled, action) => withTiming(enabled, 'save', savePhases, action);
export const withOverviewTiming = (enabled, action) =>
  withTiming(enabled, 'overview', overviewPhases, action);
function switchTo(state, phase) {
  const now = state.clock();
  state.values[state.phase] += now - state.last;
  state.last = now;
  state.phase = phase;
}
function measure(kind, phase, action) {
  const state = request.getStore();
  if (!state || state.sealed || (kind && state.kind !== kind)) {
    return action();
  }
  const previous = state.phase;
  switchTo(state, phase);
  try {
    return action();
  } finally {
    switchTo(state, previous);
  }
}
export const measureSave = (phase, action) => measure('save', phase, action);
export const measureOverview = (phase, action) => measure('overview', phase, action);
export const measureResponseSerialization = (action) => measure(null, 'serialize', action);
export function timingHeader() {
  const state = request.getStore();
  if (!state || state.sealed) {
    return null;
  }
  switchTo(state, 'other');
  state.sealed = true;
  return Object.entries({ ...state.values, total: state.last - state.started })
    .map(([key, value]) => `${key};dur=${value.toFixed(3)}`)
    .join(', ');
}
