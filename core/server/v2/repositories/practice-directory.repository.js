import path from 'node:path';
import { checkPath, checkedStat } from '../../host/platform/files.js';

/** @param {string} directory @param {import('../types/data.js').RoundScope} [scope] */
export const practiceStatePath = (directory, scope = 'practice') =>
  path.join(directory, '.qf-v2', scope, 'state.json');

/** @param {string} directory
 * @param {{atomic?: boolean, scope?: import('../types/data.js').RoundScope}} [options] */
export function practiceDirectory(directory, { atomic = false, scope = 'practice' } = {}) {
  const local = path.join(checkPath(directory, { directory: true }), '.qf-v2');
  const practice = path.join(local, scope);
  // The default atomic writer checks existing ancestors immediately before
  // creating directories. Non-writing reads must check both private ancestors.
  if (!atomic) {
    checkedStat(local, { directory: true, optional: true });
    checkedStat(practice, { directory: true, optional: true });
  }
  return practice;
}
