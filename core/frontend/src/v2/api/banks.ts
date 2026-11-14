import type { Completion, Overview } from '../types/practice-types';
import { jsonRequest, type ApiClient } from './client';
import { writeBody } from './requests';

export const bankPath = (bankId: string) => `/api/v2/banks/${bankId}`;

export const createBankApi = (client: ApiClient) => ({
  overview: (bankId: string) => client.json<Overview>(`${bankPath(bankId)}/overview`),
  refresh: (bankId: string, questionId?: string) =>
    client.json<Overview>(
      `${bankPath(bankId)}/refresh`,
      jsonRequest('POST', JSON.stringify({ ...(questionId ? { questionId } : {}) })),
    ),
  finish: (bankId: string, snapshotId: string) =>
    client.json<Completion>(
      `${bankPath(bankId)}/finish`,
      jsonRequest('POST', writeBody(snapshotId, {})),
    ),
  // Batch scoring keeps the prepared body across failed sends in its service.
  results: (bankId: string, body: string) =>
    client.json<Completion>(`${bankPath(bankId)}/results`, jsonRequest('PUT', body)),
});
