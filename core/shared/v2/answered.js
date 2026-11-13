// Shared shape check: metadata only, never interpret an author's answer.
export const ANSWERED_PART_LIMIT = 1000;
export function validateAnswered(value) {
  if (typeof value === 'boolean') return;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('作答状态必须是布尔值或小题布尔映射。');
  const entries = Object.entries(value);
  if (entries.length > ANSWERED_PART_LIMIT || entries.some(([, flag]) => typeof flag !== 'boolean')) throw new TypeError('小题作答状态格式无效或超过 1000 项。');
}
export function mergeAnswered(value, item, previous) {
  validateAnswered(value);
  if (!item.parts) {
    if (typeof value !== 'boolean') throw new TypeError('无小题时作答状态必须是布尔值。');
    return value;
  }
  if (typeof value === 'boolean') throw new TypeError('有小题时作答状态必须是小题布尔映射。');
  const known = new Set(item.parts.map(part => part.id));
  const result = Object.fromEntries([...Object.entries(previous && typeof previous === 'object' ? previous : {}), ...Object.entries(value)].filter(([id]) => known.has(id)));
  validateAnswered(result); return result;
}
