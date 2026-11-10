import { startTiming, bindTiming } from './timing.js';
import { AsyncLocalStorage } from 'node:async_hooks';
import { ApiError } from './errors.js';

// Awaiting a rule/model call yields the Node event loop. State transactions must
// still serialize the read/check/write sequence, including reentrant helpers.
export class SerialTransactions {
  constructor() { this.tail = Promise.resolve(); this.context = new AsyncLocalStorage(); }
  run(operation) {
    const inherited = this.context.getStore();
    if (inherited?.active) return operation();
    const endWait = startTiming('queue');
    const result = this.tail.then(() => {
      endWait();
      const token = { active: true };
      return this.context.run(token, async () => { try { return await operation(); } finally { token.active = false; } });
    });
    this.tail = result.then(() => {}, () => {});
    return result;
  }
  drain() { return this.tail; }
}
export class LoadCoordinator {
  constructor() { this.jobs = new Map(); this.foreground = []; this.background = []; this.running = { foreground: false, background: false }; this.closed = false; }
  submit(key, foreground, operation) {
    if (this.closed) return Promise.reject(new ApiError(503, 'LIBRARY_UNAVAILABLE', 'Library is closed'));
    let job = this.jobs.get(key);
    if (job) {
      if (foreground && !job.started && !job.foreground) {
        this.background.splice(this.background.indexOf(job), 1); job.foreground = true; this.foreground.push(job); this.pump('foreground');
      }
      return job.promise;
    }
    if (this.foreground.length + this.background.length >= 1200) return Promise.reject(new ApiError(503, 'SERVER_BUSY', 'Library load queue is full'));
    let resolve, reject;
    const promise = new Promise((accept, decline) => { resolve = accept; reject = decline; });
    job = { key, foreground, operation: bindTiming(operation), promise, resolve, reject, started: false, cancelled: false };
    this.jobs.set(key, job); (foreground ? this.foreground : this.background).push(job); this.pump(foreground ? 'foreground' : 'background');
    return promise;
  }
  async pump(lane) {
    if (this.running[lane] || this.closed) return;
    this.running[lane] = true;
    try {
      while (this[lane].length && !this.closed) {
        const job = this[lane].shift();
        if (job.cancelled) continue;
        job.started = true;
        try {
          const value = await job.operation();
          if (!job.cancelled && !this.closed) job.resolve(value);
        } catch (error) { job.reject(error); }
        finally { if (this.jobs.get(job.key) === job) this.jobs.delete(job.key); }
      }
    } finally { this.running[lane] = false; }
  }
  invalidate(predicate) {
    for (const [key, job] of this.jobs) if (predicate(key)) {
      job.cancelled = true; this.jobs.delete(key); job.reject(new ApiError(409, 'LIBRARY_CHANGED', 'Library changed while loading'));
    }
    this.foreground = this.foreground.filter(job => !job.cancelled); this.background = this.background.filter(job => !job.cancelled);
  }
  close() {
    this.closed = true;
    for (const job of this.jobs.values()) { job.cancelled = true; job.reject(new ApiError(503, 'LIBRARY_UNAVAILABLE', 'Library is closed')); }
    this.jobs.clear(); this.foreground.length = 0; this.background.length = 0;
  }
}
