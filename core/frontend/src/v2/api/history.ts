import type { HistoryRoundSummary, HistoryOverviewResponse } from '../../../../shared/v2/api.js';
import type { ApiClient } from './client';
import { bankPath } from './banks';

export const roundPath = (bankId: string, roundId: string) =>
  `${bankPath(bankId)}/rounds/${encodeURIComponent(roundId)}`;

export function createHistoryApi(client: ApiClient) {
  return {
    list: (bankId: string) => client.json<HistoryRoundSummary[]>(`${bankPath(bankId)}/rounds`),
    overview: (bankId: string, roundId: string) =>
      client.json<HistoryOverviewResponse>(`${roundPath(bankId, roundId)}/overview`),
    async remove(bankId: string, roundId: string) {
      await client.response(roundPath(bankId, roundId), { method: 'DELETE' });
    },
  };
}
