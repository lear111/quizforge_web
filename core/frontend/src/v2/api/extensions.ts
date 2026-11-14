import type { ApiClient } from './client';

interface Manifest {
  name: string;
  sdkVersions?: Record<string, string>;
}
const extensionPath = (artifactId: string) =>
  `/api/v2/extensions/${encodeURIComponent(artifactId)}`;

export const createExtensionApi = (client: Pick<ApiClient, 'json' | 'text'>) => ({
  manifest: (artifactId: string, signal: AbortSignal) =>
    client.json<Manifest>(`${extensionPath(artifactId)}/manifest`, { signal }),
  file: (artifactId: string, name: string, signal?: AbortSignal) =>
    client.text(`${extensionPath(artifactId)}/files/${name}`, { signal }),
});
