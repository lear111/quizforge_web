import fs from 'node:fs';
import path from 'node:path';
import { LibrarySnapshots } from '../../server/v2/services/bank.service.js';
import { PracticeState } from '../../server/v2/services/practice.service.js';
import { hash, jsonBytes } from '../../server/host/platform/json.js';
import { createReadFixture, writeFixtureFile } from './v2-banks.mjs';

export function setupPracticeStorage(t) {
  const fixture = createReadFixture();
  t.after(() => fixture.cleanup());
  const store = new PracticeState();
  const library = new LibrarySnapshots(fixture.root, fixture.codeRoot, { stateStore: store });
  const id = library.locations()[0].bankId;
  const opened = library.open(id);
  const snapshot = library.opened.get(id);
  const local = path.join(fixture.directory, '.qf-v2');
  const legacyFile = path.join(local, 'state.json');
  const legacyInk = path.join(
    local,
    'ink',
    snapshot.contentFingerprint,
    hash(Buffer.from('1')) + '.json',
  );
  const write = (op, fields) =>
    library.write(id, '1', op, {
      snapshotId: opened.snapshotId,
      ...fields,
    });
  return { fixture, store, library, id, snapshot, local, legacyFile, legacyInk, write };
}

export function seedLegacy(f) {
  writeFixtureFile(f.legacyFile, {
    formatVersion: 2,
    contentFingerprint: f.snapshot.contentFingerprint,
    lastQuestionId: '1',
    questions: {
      1: {
        answer: 'OLD_DEVELOPMENT_ANSWER',
        status: 'answered',
        result: null,
        submissionId: null,
        revision: 9,
        receipts: [],
      },
    },
  });
  writeFixtureFile(f.legacyInk, { ink: ['old-ink'], inkRevision: 9, receipts: [] });
}

export function seedCurrentAndNeighbors(f) {
  f.write('answer', { requestId: 'current', expectedRevision: 0, answer: 'current-answer' });
  f.write('ink', { requestId: 'current-ink', expectedInkRevision: 0, ink: ['current-ink'] });
  writeFixtureFile(path.join(f.local, 'exam/unknown.json'), 'exam-neighbor-sentinel');
  writeFixtureFile(path.join(f.local, 'rounds/one/state.json'), 'future-round-sentinel');
  writeFixtureFile(path.join(f.local, 'unrelated.txt'), 'keep');
}

export function treeBytes(directory) {
  if (!fs.existsSync(directory)) {
    return {};
  }
  return Object.fromEntries(
    fs
      .readdirSync(directory, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => {
        const file = path.join(entry.parentPath, entry.name);
        return [path.relative(directory, file), hash(fs.readFileSync(file))];
      }),
  );
}

export function currentBytes(f) {
  return jsonBytes(f.store.load(f.fixture.directory));
}
