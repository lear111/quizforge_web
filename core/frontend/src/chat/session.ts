import { reactive } from 'vue';

export type Message = { role: 'user' | 'assistant'; content: string };
type VisibleMessage = Message & { id: number };
export type ChatRequest = (path: string, options: {
  method: 'POST'; body: string; signal: AbortSignal; timeoutMs: number;
}) => Promise<unknown>;

// One ephemeral conversation. A failed/cancelled turn never enters model history.
export function createChatSession(request: ChatRequest) {
  const state = reactive({ draft: '', messages: [] as VisibleMessage[], busy: false, status: '', error: false });
  const history: Message[] = [];
  let nextId = 0, disposed = false;
  let pending: { controller: AbortController; content: string; id: number } | null = null;

  function remove(id: number) { state.messages = state.messages.filter(message => message.id !== id); }
  function restore(content: string) { if (!state.draft) state.draft = content; }

  async function submit() {
    if (disposed || pending || !state.draft.trim()) return;
    const content = state.draft.trim();
    if (content.length > 4000) { state.status = '单条消息最多 4000 字，请缩短后重试。'; state.error = true; return; }
    const messages = history.map(message => ({ ...message }));
    while (messages.length > 30 || messages.reduce((sum, message) => sum + message.content.length, content.length) > 48000) messages.splice(0, 2);
    messages.push({ role: 'user', content });
    const operation = { controller: new AbortController(), content, id: ++nextId };
    pending = operation;
    state.messages.push({ id: operation.id, role: 'user', content });
    state.draft = ''; state.busy = true; state.status = 'AI 正在回复…'; state.error = false;
    try {
      const result = await request('/api/ai/chat', { method: 'POST', body: JSON.stringify({ messages }), signal: operation.controller.signal, timeoutMs: 135000 });
      if (disposed || pending !== operation) return;
      const reply = result && typeof result === 'object' && 'message' in result ? result.message : null;
      if (typeof reply !== 'string' || !reply.trim() || reply.length > 24000) throw Error('AI 没有返回可用的回复，请重试。');
      history.splice(0, history.length, ...messages, { role: 'assistant', content: reply });
      state.messages.push({ id: ++nextId, role: 'assistant', content: reply }); state.status = '';
    } catch (error: unknown) {
      if (disposed || pending !== operation) return;
      remove(operation.id); restore(content);
      const failure = error as { code?: string; message?: string } | null;
      const hints: Record<string, string> = {
        AI_NOT_CONFIGURED: '请先在设置 → AI 评分中选择并配置 AI 调用来源。',
        AI_REFUSED: '模型未能回复此消息，请调整内容后重试。',
        AI_INPUT_LIMIT: '对话超过模型调用上限，请缩短内容后重试。',
      };
      state.status = hints[failure?.code || ''] || '发送失败：' + (failure?.message || '请稍后重试。'); state.error = true;
    } finally {
      if (pending === operation) { pending = null; state.busy = false; }
    }
  }

  function cancel() {
    if (!pending) return;
    const operation = pending; pending = null; operation.controller.abort();
    remove(operation.id); restore(operation.content);
    state.busy = false; state.status = '已停止，输入已保留。'; state.error = false;
  }
  function dispose() { cancel(); disposed = true; }
  return { state, submit, cancel, dispose };
}
