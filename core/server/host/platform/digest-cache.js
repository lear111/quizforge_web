// Logical budget: conservative string storage plus Map/record overhead estimate.
// This bounds retained metadata, not the VM's entire heap or temporary reads.
export function digestEntryBytes(file, identity, hash) { return 384 + 2 * (file.length + identity.length + hash.length); }

/** Retain the lexically smallest paths. A sequential scan larger than capacity
 * cannot evict its own prefix on every pass (unlike an ordinary LRU). No bytes,
 * parsed values, stat objects or fingerprints are retained here. */
export class DigestCache {
  constructor({ count = 8192, bytes = 64 * 1024 * 1024 } = {}) {
    if (!Number.isSafeInteger(count) || count < 1 || !Number.isSafeInteger(bytes) || bytes < 1) throw new Error('Invalid digest cache budget');
    this.count = count; this.limit = bytes; this.entries = new Map(); this.bytes = 0; this.largest = null;
  }
  get(file, identity) { const value = this.entries.get(file); return value?.identity === identity ? value.hash : null; }
  delete(file) {
    const old = this.entries.get(file);
    if (!old) return;
    this.bytes -= digestEntryBytes(file, old.identity, old.hash); this.entries.delete(file);
    if (this.largest === file) { this.largest = null; for (const key of this.entries.keys()) if (this.largest === null || key > this.largest) this.largest = key; }
  }
  set(file, identity, hash) {
    this.delete(file);
    const size = digestEntryBytes(file, identity, hash);
    if (size > this.limit) return;
    // Reject a new tail before eviction; otherwise a capacity+1 scan thrashes.
    if ((this.entries.size >= this.count || this.bytes + size > this.limit) && this.largest !== null && file > this.largest) return;
    this.entries.set(file, { identity, hash }); this.bytes += size;
    if (this.largest === null || file > this.largest) this.largest = file;
    while (this.entries.size > this.count || this.bytes > this.limit) this.delete(this.largest);
  }
  clear() { this.entries.clear(); this.bytes = 0; this.largest = null; }
}
