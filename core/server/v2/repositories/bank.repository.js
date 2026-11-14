import { freezeJson } from '../../host/platform/json.js';
import { object, problem } from '../utils/errors.js';
import { readJson, READ_LIMITS } from '../utils/io.js';
import { relativeFile } from './resource.repository.js';
import { outlineIndex } from './outline.repository.js';
export const validId = (value) =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= 120 &&
  // eslint-disable-next-line no-control-regex -- Identifiers deliberately reject control bytes.
  !/[\x00-\x1f\x7f/\\]/.test(value);

function listeningMaterials(raw, items) {
  // Opening builds only the display list. Reading a local file still goes
  // through relativeFile; authoring checks belong to the later listening work.
  const listening = new Map();
  for (const item of items.values()) {
    const id = item.listening;
    if (id !== undefined && !listening.has(id)) {
      const value = raw.listening?.[id];
      listening.set(id, {
        id,
        title: value?.title ?? '',
        src: value?.src ?? '',
        remote: /^https?:\/\//i.test(value?.src ?? ''),
      });
    }
  }
  return listening;
}
export function readBank(directory, cache, bankId) {
  const raw = readJson(relativeFile(directory, 'bank.json'), cache, READ_LIMITS.bankBytes, {
    bankId,
    field: 'bank.json',
  });
  const { items, maxScores } = outlineIndex(raw?.outline, bankId);
  freezeJson(raw);
  return {
    raw,
    items,
    maxScores,
    listening: listeningMaterials(raw, items),
    info: {
      bankId,
      sourceId: raw.id ?? '',
      title: raw.title ?? '',
      description: raw.description ?? '',
      features: { history: raw.features?.history ?? true, exam: raw.features?.exam ?? true },
    },
  };
}
export function questionRecord(bank, id) {
  const context = { bankId: bank.info.bankId, questionId: id };
  if (
    !bank.items.has(id) ||
    !object(bank.raw.questions) ||
    !Object.hasOwn(bank.raw.questions, id)
  ) {
    throw problem(
      'QUESTION_NOT_FOUND',
      '大纲中的这道题在 questions 中不存在。',
      { ...context, field: `questions.${id}` },
      404,
    );
  }
  const record = bank.raw.questions[id];
  if (!object(record)) {
    throw problem('QUESTION_INVALID', '这道题的记录必须是对象。', {
      ...context,
      field: `questions.${id}`,
    });
  }
  for (const field of ['question', 'solution']) {
    if (!object(record[field])) {
      throw problem('QUESTION_INVALID', `这道题的 ${field} 必须是对象，不能是数组或 null。`, {
        ...context,
        field: `questions.${id}.${field}`,
      });
    }
  }
  return record;
}
