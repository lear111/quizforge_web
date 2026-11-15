import type { AnswerRequest } from '../../../../../../shared/v2/api.js';
export type AnswerFields = Pick<AnswerRequest, 'answer' | 'answered'>;
export interface SaveSnapshot {
  fields: AnswerFields | null;
  ink: unknown;
  av: number;
  iv: number;
}
export type SaveOperation =
  { kind: 'answer'; fields: AnswerFields } | { kind: 'ink'; ink: unknown };
