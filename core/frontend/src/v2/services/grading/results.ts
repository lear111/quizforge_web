import type { GradeResult, GradingInput, GradingOutput } from './types.js';

export const ungradable = (message: string): GradeResult => ({ score: null, parts: null, message });
export const unavailable = (items: GradingInput[], reason: string): GradingOutput[] =>
  items.map(({ questionId }) => ({
    questionId,
    result: ungradable(reason),
  }));
// Worker messages are untrusted. A grade function can return only a score and
// optional parts; the host assigns the error message and the server checks scores.
export function normalize(items: GradingInput[], results: unknown): GradingOutput[] {
  return items.map(({ questionId }) => {
    const entries = Array.isArray(results)
      ? results.filter(
          (entry) => entry && typeof entry === 'object' && entry.questionId === questionId,
        )
      : [];
    const entry = entries.length === 1 ? entries[0] : null;
    const result = entry?.result;
    if (typeof entry?.error === 'string' && entry.error.trim()) {
      return { questionId, result: ungradable(entry.error) };
    }
    const invalid = () => ({ questionId, result: ungradable('题型返回的评分结果无效。') });
    if (
      !result ||
      typeof result !== 'object' ||
      Array.isArray(result) ||
      !Object.hasOwn(result, 'score') ||
      Object.keys(result).some((key) => key !== 'score' && key !== 'parts')
    ) {
      return invalid();
    }
    if (result.score === null) {
      return Object.hasOwn(result, 'parts')
        ? invalid()
        : { questionId, result: { score: null, parts: null, message: null } };
    }
    if (typeof result.score !== 'number' || !Number.isFinite(result.score)) {
      return invalid();
    }
    const parts = Object.hasOwn(result, 'parts') ? result.parts : null;
    if (
      Object.hasOwn(result, 'parts') &&
      (!parts ||
        typeof parts !== 'object' ||
        Array.isArray(parts) ||
        !Object.values(parts).every(Number.isFinite))
    ) {
      return invalid();
    }
    return { questionId, result: { score: result.score, parts, message: null } };
  });
}
