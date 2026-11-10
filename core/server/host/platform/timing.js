import { AsyncLocalStorage } from 'node:async_hooks';
import { performance } from 'node:perf_hooks';

const context = new AsyncLocalStorage();
// Overlapping wall time belongs to the most specific category in this order.
// In particular clone time inside a rule call is not also counted as rules.
const phases = ['library', 'state-load', 'persist', 'rules', 'clone', 'queue', 'response-json'];
export class Timing {
  constructor(now = () => performance.now()) { this.now = now; this.started = now(); this.intervals = []; this.pending = new Set(); this.sealed = false; this.truncated = false; }
  start(phase) {
    if (this.sealed) return () => {};
    if (!phases.includes(phase)) throw new Error('Unknown timing phase');
    if (this.intervals.length + this.pending.size >= 100000) { this.truncated = true; return () => {}; }
    const interval = { phase, start: this.now() }; this.pending.add(interval);
    return () => { if (!this.pending.delete(interval) || this.sealed) return; interval.end = this.now(); this.intervals.push(interval); };
  }
  values() {
    const end = this.now(), events = [], active = phases.map(() => 0);
    for (const interval of [...this.intervals, ...this.pending]) {
      const rank = phases.indexOf(interval.phase);
      events.push([interval.start, rank, 1], [Math.min(interval.end ?? end, end), rank, -1]);
    }
    events.sort((a, b) => a[0] - b[0]);
    const values = Object.fromEntries(phases.map(phase => [phase, 0])); values.other = 0;
    let previous = this.started;
    for (const [time, rank, delta] of [...events, [end, 0, 0]]) {
      const current = active.findLastIndex(count => count > 0);
      values[current < 0 ? 'other' : phases[current]] += Math.max(0, time - previous);
      active[rank] += delta; previous = time;
    }
    values.total = end - this.started; return values;
  }
  header() { const values = this.values(); this.sealed = true; return Object.entries(values).map(([name, value]) => `${name};dur=${value.toFixed(3)}`).join(', ') + (this.truncated ? ', incomplete;desc="interval limit"' : ''); }
}
export const withTiming = (timing, callback) => context.run(timing, callback);
// Coordinator pumps can outlive the request which first started them. Capture
// only diagnostics, never transaction ownership or any other async context.
export function bindTiming(callback) { const timing = context.getStore(); return function (...args) { return context.run(timing, () => callback.apply(this, args)); }; }
export const startTiming = phase => context.getStore()?.start(phase) ?? (() => {});
export const timingHeader = () => context.getStore()?.header();
export function timed(phase, callback) {
  if (!context.getStore()) return callback();
  const end = startTiming(phase);
  try { const result = callback(); if (result && typeof result.then === 'function') return result.then(value => { end(); return value; }, error => { end(); throw error; }); end(); return result; }
  catch (error) { end(); throw error; }
}
export function timeMethods(instance, phase, names) {
  for (const name of names) { const original = instance[name]; instance[name] = function (...args) { return timed(phase, () => original.apply(this, args)); }; }
}
