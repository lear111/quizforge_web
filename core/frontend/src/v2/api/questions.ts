import type { Question } from '../types/practice-types';
import { bankPath } from './banks';
import { jsonRequest, type ApiClient } from './client';
import { snapshotQuery, writeBody } from './requests';

type QuestionKey = Pick<Question, 'bankId' | 'questionId' | 'snapshotId'>;
const questionPath = (q: Pick<QuestionKey, 'bankId' | 'questionId'>) =>
  `${bankPath(q.bankId)}/questions/${encodeURIComponent(q.questionId)}`;
const prepareSave = (q: Question, kind: string, fields: Record<string, unknown>) => ({
  route: `${questionPath(q)}/${kind}`,
  body: writeBody(q.snapshotId, fields),
});

export function createQuestionApi(client: ApiClient) {
  const write = (q: Question, action: string, method: string, fields: Record<string, unknown>) =>
    client.json<Question>(
      `${questionPath(q)}/${action}`,
      jsonRequest(method, writeBody(q.snapshotId, fields)),
    );
  return {
    get: (q: QuestionKey) => client.json<Question>(questionPath(q) + snapshotQuery(q.snapshotId)),
    asset: (q: QuestionKey, assetId: string) =>
      client.response(`${questionPath(q)}/assets/${assetId}` + snapshotQuery(q.snapshotId)),
    prepareAnswer: (q: Question, fields: Record<string, unknown>) =>
      prepareSave(q, 'answer', { expectedRevision: q.state.revision, ...fields }),
    prepareInk: (q: Question, ink: unknown) =>
      prepareSave(q, 'ink', { expectedInkRevision: q.inkRevision, ink }),
    sendSave: (route: string, body: string) =>
      client.json<Question>(route, jsonRequest('PUT', body)),
    submit: (q: Question, answer: unknown) =>
      write(q, 'submit', 'POST', { expectedRevision: q.state.revision, answer }),
    retry: (q: Question) => write(q, 'retry', 'POST', { expectedRevision: q.state.revision }),
    result: (q: Question, result: unknown) =>
      write(q, 'result', 'PUT', {
        submissionId: q.submissionId,
        expectedRevision: q.state.revision,
        source: 'grader',
        result,
      }),
  };
}
