/** @typedef {import('../../../shared/v2/state.js').InkFile} InkFile */
import {
  cloneJson,
  fingerprint,
  freezeJson,
  jsonBytes,
  projectJson,
} from '../../host/platform/json.js';
/** @typedef {typeof import('../../host/platform/files.js').replaceFile} WriteInk */
import { object, problem } from '../utils/errors.js';
import { integer } from '../utils/state.js';
import { appendReceipt, replayed } from '../utils/receipts.js';
import { measureSave } from '../utils/timing.js';

/**
 * Shared transaction, with the scope's checked file resolver supplied by its repository.
 * @param {{read(): InkFile, file(): string, write: WriteInk, saved?(): void}} store
 * @param {unknown} input
 */
export function applyInkFile(store, input) {
  if (
    !object(input) ||
    typeof input.requestId !== 'string' ||
    !input.requestId.trim() ||
    !Object.hasOwn(input, 'ink')
  ) {
    throw problem('INVALID_REQUEST', '请求标识无效或缺少草稿笔迹。', {}, 400);
  }
  const old = store.read(),
    signature = fingerprint({ op: 'ink', input }, 'quizforge-v2-receipt'),
    key = input.requestId;
  if (replayed(old.receipts, key, signature)) {
    return old;
  }
  if (!integer(input.expectedInkRevision) || input.expectedInkRevision !== old.inkRevision) {
    throw problem('REVISION_CONFLICT', '草稿笔迹已变化，请重新打开本题。', {}, 409);
  }
  if (!integer(old.inkRevision + 1)) {
    throw problem('STATE_INVALID', '笔迹版本无法继续递增。', {}, 503);
  }
  const value = Object.assign(cloneJson(projectJson(input, ['ink'])), {
    inkRevision: old.inkRevision + 1,
    receipts: appendReceipt(old.receipts, key, signature),
  });
  persistInk(store, value);
  store.saved?.();
  return freezeJson(value);
}

/** @param {{file(): string, write: WriteInk}} store @param {InkFile} value */
function persistInk(store, value) {
  const bytes = measureSave('serialize', () => jsonBytes(value));
  if (bytes.length > 32 * 1024 * 1024) {
    throw problem('STATE_SIZE_LIMIT', '本题草稿笔迹超过 32 MiB，本次未保存，原记录保留。', {}, 413);
  }
  try {
    measureSave('write', () => store.write(store.file(), bytes));
  } catch {
    throw problem('STATE_WRITE_FAILED', '草稿笔迹未能保存，请重试；原记录保持不变。', {}, 503);
  }
}
