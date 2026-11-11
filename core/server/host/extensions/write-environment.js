import path from 'node:path';
import { fileIdentity } from '../platform/file-cache.js';

export const WRITE_ENVIRONMENT_REUSE_MS = 10 * 60 * 1000;
const dependencies = ['ajv', 'fast-uri', 'fast-deep-equal', 'json-schema-traverse', 'require-from-string'];
const same = (left, right) => left?.length === right?.length && left.every((value, index) => value === right[index]);

// This cache only gates writes. It never changes the fingerprint or read TTL.
export class WriteEnvironment {
  constructor(codeRoot, { now = Date.now, nodePath = () => process.execPath } = {}) {
    this.codeRoot = path.resolve(codeRoot); this.now = now; this.nodePath = nodePath;
    this.generation = 0; this.cached = null; this.fullWriteRequired = true;
  }
  sentinels() {
    const files = [this.nodePath(), path.join(this.codeRoot, 'server', 'rules-runner.cjs'), ...dependencies.map(name => path.join(this.codeRoot, 'node_modules', name, 'package.json'))];
    // fileIdentity uses checkedStat: one lstat per file, with the existing
    // regular-file, symlink and canonical-path checks. No unchecked stat cache.
    return files.map(file => path.resolve(file) + '\0' + fileIdentity(file));
  }
  begin() {
    this.cached = null;
    const ticket = { generation: this.generation, at: this.now(), sentinels: null };
    try { ticket.sentinels = this.sentinels(); } catch { /* A failed guard cannot authorize reuse. */ }
    return ticket;
  }
  complete(ticket, value) {
    if (ticket.generation !== this.generation || value === 'unavailable' || !ticket.sentinels) return;
    try { if (same(ticket.sentinels, this.sentinels())) this.cached = { value, at: ticket.at, sentinels: ticket.sentinels }; } catch { /* The next write must compute again. */ }
  }
  async get(full) {
    const cached = this.cached, age = cached ? this.now() - cached.at : -1;
    if (!this.fullWriteRequired && cached && age >= 0 && age <= WRITE_ENVIRONMENT_REUSE_MS) {
      try { if (same(cached.sentinels, this.sentinels())) return cached.value; } catch { /* Recheck the full environment below. */ }
    }
    // Clear before awaiting, so an invalidate during computation stays pending.
    this.fullWriteRequired = false;
    return full();
  }
  requireFullWrite() { this.fullWriteRequired = true; }
  clear() { this.generation++; this.cached = null; this.fullWriteRequired = true; }
}
