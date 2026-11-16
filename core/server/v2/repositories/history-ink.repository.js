/** @typedef {import('../types/history.js').HistoryRound} HistoryRound */
import { replaceFile } from '../../host/platform/files.js';
import { historyInkFile, readHistoryInkRecord } from './history.repository.js';
import { applyInkFile } from './ink-write.repository.js';

// No PracticeInk directory/open/clear methods: this resolver can only reach the round's ink.
export class HistoryInk {
  constructor() {
    this.write = replaceFile;
  }
  /** @param {HistoryRound} round @param {string} id @param {unknown} input */
  apply(round, id, input) {
    return applyInkFile(
      {
        read: () => readHistoryInkRecord(round, id),
        file: () => historyInkFile(round, id),
        write: this.write,
      },
      input,
    );
  }
}
