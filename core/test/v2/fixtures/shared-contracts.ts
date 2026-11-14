import type {
  AnswerRequest,
  InkRequest,
  InkResponse,
  QuestionResponse,
  QuestionReadResponse,
  ApiErrorCode,
  ResultsRequest,
  ResultEntry,
} from '../../../shared/v2/api.js';
import type { StateFile, GradeResult } from '../../../shared/v2/state.js';
import type { JsonValue } from '../../../shared/v2/json.js';
import type { BankFile, BankInfo } from '../../../shared/v2/bank.js';
import type { createApi } from '../../../frontend/src/v2/api/index.js';

type Assert<T extends true> = T;
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Api = ReturnType<typeof createApi>;
export type GetReturnsInk = Assert<
  Equal<Awaited<ReturnType<Api['questions']['get']>>, QuestionReadResponse>
>;
export type SaveReturnsUnion = Assert<
  Equal<Awaited<ReturnType<Api['questions']['sendSave']>>, QuestionResponse | InkResponse>
>;
export type RetryReturnsInk = Assert<
  Equal<Awaited<ReturnType<Api['questions']['retry']>>, QuestionReadResponse>
>;
export type OpaqueAnswer = Assert<Equal<QuestionResponse['answer'], unknown>>;
export type OpaqueQuestion = Assert<Equal<QuestionResponse['question'], unknown>>;
export type OpaqueSolution = Assert<Equal<QuestionResponse['solution'], unknown>>;

export const empty: StateFile = { formatVersion: 2, questions: {} };
export const state: StateFile = {
  formatVersion: 2,
  contentFingerprint: 'digest',
  lastQuestionId: 'q',
  questions: {
    q: {
      status: { p: 'correct' },
      answer: { extensionOwnsThis: ['anything'] },
      result: { score: 2, parts: { p: 2 }, message: null },
      submissionId: 'lock',
      revision: 3,
      receipts: [{ requestId: 'r', signature: 'hash' }],
    },
  },
};
export const answer: AnswerRequest = {
  requestId: 'r',
  snapshotId: 's',
  expectedRevision: 0,
  answer: ['opaque'],
  answered: { p: true },
};
export const ink: InkRequest = {
  requestId: 'r',
  snapshotId: 's',
  expectedInkRevision: 0,
  ink: null,
};
export const result: GradeResult = { score: null, parts: null, message: 'unable to grade' };
export const entry: ResultEntry = {
  questionId: 'q',
  submissionId: 'lock',
  expectedRevision: 1,
  result,
};
export const batch: ResultsRequest = { requestId: 'r', snapshotId: 's', results: [entry] };
export const code: ApiErrorCode = 'SNAPSHOT_STALE';
export const json: JsonValue = { nested: [true, null, 1.25] };
export const bank: BankFile = {
  outline: [
    {
      items: [
        { id: 'q', maxScore: 2, listening: 'local' },
        { id: 'q2', parts: [{ id: 'p', maxScore: 3 }], listening: 'remote' },
      ],
    },
  ],
  questions: { q: { type: 'choice@2', question: { src: 'qf-asset:images/1.png' }, solution: {} } },
  listening: { local: { src: 'audio/1.mp3' }, remote: { src: 'https://example.test/1.mp3' } },
};

// D46 passes unchecked display metadata through; this is not a type assertion.
export const uncheckedMetadata: BankInfo = {
  bankId: 'b',
  sourceId: 12,
  title: { text: 'raw' },
  description: [],
  features: { history: 'raw', exam: null },
};
