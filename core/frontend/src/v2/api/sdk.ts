import type { ApiClient } from './client';
import { snapshotQuery } from './requests';

export const createSdkApi = (client: Pick<ApiClient, 'text'>) => ({
  async richtext(version: string, snapshotId: string, signal: AbortSignal) {
    const root = `/api/v2/sdk/richtext/${encodeURIComponent(version)}/richtext`;
    const suffix = snapshotQuery(snapshotId);
    const [js, css] = await Promise.all([
      client.text(root + '.js' + suffix, { signal }),
      client.text(root + '.css' + suffix, { signal }),
    ]);
    return { js, css };
  },
});
