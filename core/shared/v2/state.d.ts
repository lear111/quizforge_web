import type { OutlineStatus } from './answered.js';

// question/solution/answer belong to the extension; the host does not interpret
// them or message text. Scores, parts and outline status have host-owned types.
export type GradeResult =
  | { score: number; parts: Record<string, number> | null; message: null }
  | { score: null; parts: null; message: string | null };
export interface Receipt {
  requestId: string;
  signature: string;
}
export interface QuestionState {
  status: OutlineStatus;
  answer: unknown;
  result: GradeResult | null;
  submissionId: string | null;
  revision: number;
  receipts: Receipt[];
}
/** Empty records omit the optional keys; opening alone does not create a file. */
export interface StateFile {
  formatVersion: 2;
  contentFingerprint?: string;
  lastQuestionId?: string | null;
  completedAt?: string | null;
  questions: Record<string, QuestionState>;
}
export interface InkFile {
  ink: unknown;
  inkRevision: number;
  receipts: Receipt[];
}
export interface StateSummary {
  questionId: string;
  revision: number;
  status: OutlineStatus;
  locked: boolean;
  hasSavedAnswer: boolean;
  score: number | null;
  maxScore: number;
  hasInk: boolean;
}
