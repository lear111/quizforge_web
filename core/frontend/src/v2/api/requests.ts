import type { WriteRequest } from '../../../../shared/v2/api.js';
export const createRequestId = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(16)), (n) =>
    n.toString(16).padStart(2, '0'),
  ).join('');

export const snapshotQuery = (snapshotId: string) =>
  `?snapshotId=${encodeURIComponent(snapshotId)}`;

// Call only when an operation is first dispatched. Save recovery retains these
// bytes, including the request ID and revision, after an uncertain response.
export const writeBody = (snapshotId: string, fields: object, requestId = createRequestId()) =>
  JSON.stringify({ requestId, snapshotId, ...fields } satisfies WriteRequest);
