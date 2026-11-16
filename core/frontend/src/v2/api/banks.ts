import type {
  CompletionResponse,
  OverviewResponse,
  FinishResponse,
  ExamRequest,
  RefreshRequest,
  RefreshResponse,
} from '../../../../shared/v2/api.js';
import { jsonRequest, type ApiClient } from './client';
import { writeBody } from './requests';

export const bankPath = (bankId: string) => `/api/v2/banks/${bankId}`;

export const createBankApi = (client: ApiClient) => ({
  overview: (bankId: string) => client.json<OverviewResponse>(`${bankPath(bankId)}/overview`),
  refresh: (bankId: string, questionId?: string) =>
    client.json<RefreshResponse>(
      `${bankPath(bankId)}/refresh`,
      jsonRequest(
        'POST',
        JSON.stringify({ ...(questionId ? { questionId } : {}) } satisfies RefreshRequest),
      ),
    ),
  startExam: (bankId: string, snapshotId: string, durationMinutes: number) =>
    client.json<OverviewResponse>(
      `${bankPath(bankId)}/exam`,
      jsonRequest(
        'POST',
        writeBody(snapshotId, { durationMinutes } satisfies Pick<ExamRequest, 'durationMinutes'>),
      ),
    ),
  finish: (bankId: string, snapshotId: string) =>
    client.json<FinishResponse>(
      `${bankPath(bankId)}/finish`,
      jsonRequest('POST', writeBody(snapshotId, {})),
    ),
  // Batch scoring keeps the prepared body across failed sends in its service.
  results: (bankId: string, body: string) =>
    client.json<CompletionResponse>(`${bankPath(bankId)}/results`, jsonRequest('PUT', body)),
  restart: (bankId: string, body: string) =>
    client.json<OverviewResponse>(`${bankPath(bankId)}/restart`, jsonRequest('POST', body)),
});
