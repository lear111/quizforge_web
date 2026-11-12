import { decimalSum, freezeJson } from '../platform/json.js';
import { object, problem } from './errors.js';
import { readJson, relativeFile, READ_LIMITS } from './io.js';

export const validId = value => typeof value === 'string' && value.length > 0 && value.length <= 120 && !/[\x00-\x1f\x7f/\\]/.test(value);
const label = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 200;
const positive = value => typeof value === 'number' && Number.isFinite(value) && value > 0;
export function readBank(directory, cache, bankId) {
  const raw = readJson(relativeFile(directory, 'bank.json'), cache, READ_LIMITS.bankBytes, { bankId, field: 'bank.json' });
  const fail = (field, reason, questionId) => { throw problem('BANK_STRUCTURE_INVALID', `题库的大纲或信息有误：${field}，${reason}`, { bankId, ...(questionId === undefined ? {} : { questionId }), field }); };
  if (!object(raw) || raw.formatVersion !== 2) throw problem('BANK_FORMAT_UNSUPPORTED', '此题库不是 V2 题库文件（formatVersion 必须为 2）。', { bankId, field: 'formatVersion' });
  if (!validId(raw.id)) fail('id', '必须是非空的题库标识');
  if (!label(raw.title)) fail('title', '必须是非空标题');
  if (raw.description !== undefined && typeof raw.description !== 'string') fail('description', '必须是文字');
  if (raw.features !== undefined && !object(raw.features)) fail('features', '必须是对象');
  for (const key of ['history', 'exam']) if (raw.features?.[key] !== undefined && typeof raw.features[key] !== 'boolean') fail(`features.${key}`, '必须为 true 或 false');
  if (!Array.isArray(raw.outline)) fail('outline', '必须是分组数组');
  if (raw.listening !== undefined && !object(raw.listening)) fail('listening', '必须是听力材料对象');
  const items = new Map(), maxScores = new Map(), listening = new Map();
  for (let gi = 0; gi < raw.outline.length; gi++) {
    const group = raw.outline[gi], gp = `outline[${gi}]`;
    if (!object(group) || !label(group.title) || !Array.isArray(group.items)) fail(gp, '分组须有标题和 items 数组');
    for (let qi = 0; qi < group.items.length; qi++) {
      const item = group.items[qi], ip = `${gp}.items[${qi}]`;
      if (!object(item) || !validId(item.id)) fail(ip + '.id', '大题题号必须是非空字符串');
      if (items.has(item.id)) fail(ip + '.id', '大题题号在全库重复', item.id);
      if (Object.hasOwn(item, 'parts')) {
        if (Object.hasOwn(item, 'label') || Object.hasOwn(item, 'maxScore') || !Array.isArray(item.parts) || !item.parts.length) fail(ip, '有小题时只设置非空 parts，不设置大题 label/maxScore', item.id);
        const ids = new Set();
        for (let pi = 0; pi < item.parts.length; pi++) {
          const part = item.parts[pi], pp = `${ip}.parts[${pi}]`;
          if (!object(part) || !validId(part.id) || ids.has(part.id)) fail(pp + '.id', '小题题号须在该大题内唯一', item.id);
          ids.add(part.id);
          if (!label(part.label)) fail(pp + '.label', '必须填写显示编号', item.id);
          if (!positive(part.maxScore)) fail(pp + '.maxScore', '必须为大于 0 的有限数', item.id);
        }
        const total = decimalSum(item.parts.map(part => part.maxScore));
        if (!positive(total)) fail(ip + '.parts', '小题满分之和必须为有限数', item.id);
        maxScores.set(item.id, total);
      } else {
        if (!label(item.label)) fail(ip + '.label', '必须填写显示编号', item.id);
        if (!positive(item.maxScore)) fail(ip + '.maxScore', '必须为大于 0 的有限数', item.id);
        maxScores.set(item.id, item.maxScore);
      }
      items.set(item.id, item);
      if (item.listening !== undefined) {
        const id = item.listening, field = ip + '.listening';
        if (!validId(id) || !object(raw.listening) || !Object.hasOwn(raw.listening, id)) fail(field, '听力编号在顶层 listening 中不存在', item.id);
        if (!listening.has(id)) {
          const value = raw.listening[id];
          if (!object(value) || !label(value.title) || typeof value.src !== 'string' || !value.src) fail(`listening.${id}`, '必须包含标题和 src', item.id);
          let remote = false;
          if (/^https?:\/\//i.test(value.src)) {
            try { const url = new URL(value.src); remote = ['http:', 'https:'].includes(url.protocol) && !!url.hostname; } catch { /* reported below */ }
            if (!remote) fail(`listening.${id}.src`, '网络听力仅允许 http(s) 地址', item.id);
          } else {
            if (value.src.toLowerCase() === 'bank.json') fail(`listening.${id}.src`, '题库数据文件不能作为听力资源', item.id);
            relativeFile(directory, value.src);
          }
          listening.set(id, { id, title: value.title, src: value.src, remote });
        }
      }
    }
  }
  freezeJson(raw);
  return { raw, items, maxScores, listening, info: { bankId, sourceId: raw.id, title: raw.title, description: raw.description ?? '', features: { history: raw.features?.history ?? true, exam: raw.features?.exam ?? true } } };
}
export function questionRecord(bank, id) {
  const context = { bankId: bank.info.bankId, questionId: id };
  if (!bank.items.has(id) || !object(bank.raw.questions) || !Object.hasOwn(bank.raw.questions, id)) throw problem('QUESTION_NOT_FOUND', '大纲中的这道题在 questions 中不存在。', { ...context, field: `questions.${id}` }, 404);
  const record = bank.raw.questions[id];
  if (!object(record)) throw problem('QUESTION_INVALID', '这道题的记录必须是对象。', { ...context, field: `questions.${id}` });
  for (const field of ['question', 'solution']) if (!object(record[field])) throw problem('QUESTION_INVALID', `这道题的 ${field} 必须是对象，不能是数组或 null。`, { ...context, field: `questions.${id}.${field}` });
  return record;
}
