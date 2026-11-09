import { ApiError, bad, requireObject } from '../platform/errors.js';

export const CHAT_MAX_MESSAGES = 33;
export const CHAT_MAX_CHARS = 48000;
export function chatMessages(body) {
  const value = requireObject(body), messages = value.messages;
  if (Object.keys(value).some(key => key !== 'messages') || !Array.isArray(messages) || !messages.length || messages.length > CHAT_MAX_MESSAGES || messages.length % 2 !== 1) throw bad('对话格式无效，请刷新后重试。');
  let chars = 0;
  return messages.map((item, index) => {
    requireObject(item);
    if (Object.keys(item).some(key => !['role', 'content'].includes(key)) || item.role !== (index % 2 ? 'assistant' : 'user') || typeof item.content !== 'string' || !item.content.trim() || item.content.length > (index % 2 ? 24000 : 4000) || (chars += item.content.length) > CHAT_MAX_CHARS) throw bad('对话过长或格式无效，请缩短内容后重试。');
    return { role: item.role, content: item.content };
  });
}

// No server-side transcript: each page submits its own single conversation.
export class AiChatService {
  constructor(gateway) { this.gateway = gateway; this.pending = new Set(); this.closed = false; }
  async reply(body, { signal } = {}) {
    const messages = chatMessages(body);
    if (this.closed) throw new ApiError(503, 'AI_CHAT_CLOSED', '服务正在关闭，请稍后重试。');
    if (this.pending.size >= 2) throw new ApiError(429, 'AI_CHAT_BUSY', 'AI 对话正忙，请稍后重试。');
    const controller = new AbortController(), cancel = () => controller.abort();
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) cancel();
    this.pending.add(controller);
    try {
      const result = await this.gateway.chat(messages, { signal: controller.signal });
      return { message: result.output };
    } finally { this.pending.delete(controller); signal?.removeEventListener('abort', cancel); }
  }
  close() { this.closed = true; for (const controller of this.pending) controller.abort(); }
}
