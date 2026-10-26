import { ApiError } from '../platform/errors.js';

// Public content, deliberately separate from HubConnection and its credentials.
export const ADMIN_CONTACT_URL = 'https://quizforge.treenewbee.cloud/api/admin-contact';
export const ADMIN_CONTACT_MAX_BYTES = 32 * 1024;
const unavailable = () => new ApiError(502, 'ADMIN_CONTACT_UNAVAILABLE', '暂时无法读取联系方式，请重试。');

export async function readAdminContact({ signal, fetchImpl = globalThis.fetch, timeoutMs = 10000 } = {}) {
  const controller = new AbortController(); let timedOut = false;
  const cancel = () => controller.abort();
  signal?.addEventListener('abort', cancel, { once: true });
  if (signal?.aborted) cancel();
  const timer = setTimeout(() => { timedOut = true; cancel(); }, timeoutMs);
  try {
    controller.signal.throwIfAborted();
    const response = await fetchImpl(ADMIN_CONTACT_URL, { method: 'GET', headers: { Accept: 'application/json' }, credentials: 'omit', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer', signal: controller.signal });
    if (response.status !== 200 || !response.body || Number(response.headers.get('content-length')) > ADMIN_CONTACT_MAX_BYTES) throw unavailable();
    const chunks = []; let size = 0;
    for await (const chunk of response.body) {
      controller.signal.throwIfAborted(); size += chunk.byteLength;
      if (size > ADMIN_CONTACT_MAX_BYTES) throw unavailable();
      chunks.push(chunk);
    }
    controller.signal.throwIfAborted();
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
    if (!value || typeof value.content !== 'string' || value.content.length > 4000 || !Number.isSafeInteger(value.revision) || value.revision < 0) throw unavailable();
    return { content: value.content, revision: value.revision };
  } catch {
    cancel();
    if (signal?.aborted) throw new ApiError(499, 'ADMIN_CONTACT_CANCELLED', '读取已取消。');
    if (timedOut) throw new ApiError(504, 'ADMIN_CONTACT_TIMEOUT', '暂时无法读取联系方式，请重试。');
    throw unavailable();
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); }
}
