import path from 'node:path';
import { checkPath, checkedStat } from '../../host/platform/files.js';

/** @param {string} directory */
export const practiceStatePath = (directory) =>
  path.join(directory, '.qf-v2', 'practice', 'state.json');

/** @param {string} directory @param {{atomic?: boolean}} [options] */
export function practiceDirectory(directory, { atomic = false } = {}) {
  const local = path.join(checkPath(directory, { directory: true }), '.qf-v2');
  const practice = path.join(local, 'practice');
  // The default atomic writer checks existing ancestors immediately before
  // creating directories. Non-writing reads must check both private ancestors.
  if (!atomic) {
    checkedStat(local, { directory: true, optional: true });
    checkedStat(practice, { directory: true, optional: true });
  }
  return practice;
}
