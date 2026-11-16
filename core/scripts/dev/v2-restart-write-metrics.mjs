import fs from 'node:fs';

// Process-local diagnostic hooks; no production switch, no content is logged.
export function countWrites() {
  const write = fs.writeSync,
    open = fs.openSync;
  const value = { writtenBytes: 0, writtenFiles: 0 };
  fs.writeSync = (...args) => {
    const bytes = write(...args);
    value.writtenBytes += bytes;
    return bytes;
  };
  fs.openSync = (...args) => {
    const fd = open(...args);
    if (String(args[1]).includes('w')) {
      value.writtenFiles++;
    }
    return fd;
  };
  return {
    value,
    restore() {
      fs.writeSync = write;
      fs.openSync = open;
    },
  };
}
