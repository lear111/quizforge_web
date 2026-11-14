import type { ApiClient } from './client';
import type { CatalogResponse } from '../../../../shared/v2/api.js';
export const createCatalogApi = (client: ApiClient) => ({
  get: () => client.json<CatalogResponse>('/api/v2/catalog'),
});
