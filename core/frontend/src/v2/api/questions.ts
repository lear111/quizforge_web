import type {
  AnswerRequest,
  InkRequest,
  QuestionKey,
  QuestionResponse,
  QuestionReadResponse,
  SubmitRequest,
  RetryRequest,
  ResultRequest,
} from '../../../../shared/v2/api.js';
import type { GradeResult } from '../../../../shared/v2/state.js';
import { bankPath } from './banks';
import type { PreparedSave, SaveResponses } from '../types/save';
import { jsonRequest, type ApiClient } from './client';
import { snapshotQuery, writeBody } from './requests';
import { roundPath } from './history';

type Question = QuestionResponse;
type AnswerFields = Pick<AnswerRequest, 'answer' | 'answered'>;
const questionPath = (q: Pick<QuestionKey, 'bankId' | 'questionId' | 'roundId'>) =>
  `${q.roundId ? roundPath(q.bankId, q.roundId) : bankPath(q.bankId)}/questions/${encodeURIComponent(q.questionId)}`;
function writable(q: Question) {
  if (q.readOnly || q.roundId) {
    throw Error('历史记录只读。');
  }
  return q;
}
const prepareSave = <K extends keyof SaveResponses>(
  q: Question,
  kind: K,
  fields: Record<string, unknown>,
): PreparedSave<K> => ({
  kind,
  route: `${questionPath(kind === 'ink' ? q : writable(q))}/${kind}`,
  body: writeBody(q.snapshotId, fields),
});

export function createQuestionApi(client: ApiClient) {
  const write = <T>(q: Question, action: string, method: string, fields: object) =>
    client.json<T>(
      `${questionPath(writable(q))}/${action}`,
      jsonRequest(method, writeBody(q.snapshotId, fields)),
    );
  return {
    get: (q: QuestionKey) =>
      client.json<QuestionReadResponse>(questionPath(q) + snapshotQuery(q.snapshotId)),
    asset: (q: QuestionKey, assetId: string) =>
      client.response(`${questionPath(q)}/assets/${assetId}` + snapshotQuery(q.snapshotId)),
    prepareAnswer: (q: Question, fields: AnswerFields) =>
      prepareSave(q, 'answer', { expectedRevision: q.state.revision, ...fields } satisfies Omit<
        AnswerRequest,
        'requestId' | 'snapshotId'
      >),
    prepareInk: (q: Question, ink: unknown) =>
      // Current pages originate from GET; answer/result updates retain their ink revision.
      prepareSave(q, 'ink', { expectedInkRevision: q.inkRevision!, ink } satisfies Omit<
        InkRequest,
        'requestId' | 'snapshotId'
      >),
    sendSave: <K extends keyof SaveResponses>(request: PreparedSave<K>) =>
      client.json<SaveResponses[K]>(request.route, jsonRequest('PUT', request.body)),
    submit: (q: Question, answer: unknown) =>
      write<QuestionResponse>(q, 'submit', 'POST', {
        expectedRevision: q.state.revision,
        answer,
      } satisfies Omit<SubmitRequest, 'requestId' | 'snapshotId'>),
    retry: (q: Question) =>
      write<QuestionReadResponse>(q, 'retry', 'POST', {
        expectedRevision: q.state.revision,
      } satisfies Omit<RetryRequest, 'requestId' | 'snapshotId'>),
    result: (q: Question, result: GradeResult) =>
      write<QuestionResponse>(q, 'result', 'PUT', {
        // Scoring is dispatched only for a locked question.
        submissionId: q.submissionId!,
        expectedRevision: q.state.revision,
        source: 'grader',
        result,
      } satisfies Omit<ResultRequest, 'requestId' | 'snapshotId'>),
  };
}
