import type { ApiClient } from './client';

interface Catalog {
  groups: {
    id: string;
    name: string;
    items: { bankId: string; title: string; error: { message: string } | null }[];
  }[];
}
export const createCatalogApi = (client: ApiClient) => ({
  get: () => client.json<Catalog>('/api/v2/catalog'),
});
