export interface AiFields { enabled: boolean; autoGrade: boolean; useOfficial: boolean; useCustom: boolean; baseUrl: string; model: string }
export interface HubAccount { connected?: boolean; expired?: boolean; unavailable?: boolean; ai?: { enabled: boolean; balance: number } }
export interface TestReport {
  status?: string; summary?: string; model?: string; testedAt?: string; elapsedMs?: number; calls?: number; note?: string;
  checks?: { label?: string; status: string; message?: string }[];
}
export interface AiSettings extends AiFields { canManage?: boolean; apiKeyConfigured?: boolean; hub?: HubAccount; testReport?: TestReport }
export interface AiState {
  settings: AiSettings | null; fields: AiFields; hub: HubAccount; busy: boolean; testing: boolean; status: string; error: string; report: TestReport | null;
}
export interface AiConfig {
  request(path: string, options?: { method: string; body: string; timeoutMs?: number }): Promise<unknown>;
  login: { login(): Promise<HubAccount | null>; cancel(): void };
}
export interface AiHooks {
  render(state: AiState): void; readFields(): AiFields; readKey(): string; writeKey(key: string): void;
  isOpen(): boolean; show(): void; close(): void;
}
const PATH = '/api/settings/ai';
const fieldsOnly = (value: Partial<AiFields>): AiFields => ({ enabled: !!value.enabled, autoGrade: !!value.autoGrade, useOfficial: !!value.useOfficial, useCustom: !!value.useCustom, baseUrl: String(value.baseUrl ?? ''), model: String(value.model ?? '') });
const reportOnly = (value?: TestReport): TestReport | null => value ? ({ status: value.status, summary: value.summary, model: value.model, testedAt: value.testedAt, elapsedMs: value.elapsedMs, calls: value.calls, note: value.note,
  checks: value.checks?.map(({ label, status, message }) => ({ label, status, message })) }) : null;
export function describe(value: AiSettings) {
  if (value.canManage === false) return '请在运行 QuizForge 的电脑上配置 AI。其他设备可使用已开启的评分服务。';
  if (!value.enabled) return 'AI 评分未开启，仍可人工评分。';
  const sources = [value.useOfficial && '免费 AI 额度', value.useCustom && '自定义模型'].filter(Boolean);
  if (!sources.length) return '请选择至少一个评分来源。';
  const how = sources.length === 2 ? '优先使用免费 AI 额度，不可用时改用自定义模型' : `使用${sources[0]}`;
  return value.autoGrade ? `AI 评分已开启（${how}），提交答案后自动评分，结果自动保存。` : `AI 评分已开启（${how}），可在题卡点击评分，结果自动保存。`;
}
export function quota(state: AiState) {
  const hub = state.hub;
  if (state.settings?.canManage === false) return { text: hub.connected ? '已登录' : '', empty: false, muted: true };
  const text = !hub.connected ? hub.expired ? '登录已失效' : '未登录' : hub.unavailable ? '暂时查询不到余额' : !hub.ai ? '正在查询…' : !hub.ai.enabled ? '暂不可用' : '';
  return text ? { text, empty: false, muted: true } : { text: `剩余 ¥${(Math.floor(Number(hub.ai?.balance || 0) / 100) / 100).toFixed(2)}`, empty: Number(hub.ai?.balance) < 1, muted: false };
}
export function reportMeta(report: TestReport, model: string) {
  const date = new Date(report.testedAt || ''), time = Number.isNaN(date.getTime()) ? '' : date.toLocaleString();
  return `模型：${report.model || model} · ${time} · 用时 ${(Number(report.elapsedMs || 0) / 1000).toFixed(1)} 秒 · ${report.calls || 0} 次请求`;
}

// Credentials stay in the password DOM and submission-local variables, never render state.
export function createAiSettings(config: AiConfig, hooks: AiHooks) {
  let state: AiState = { settings: null, fields: fieldsOnly({}), hub: { connected: false }, busy: false, testing: false, status: '正在读取 AI 设置…', error: '', report: null };
  let epoch = 0, destroyed = false;
  const live = (token: number) => !destroyed && token === epoch && hooks.isOpen();
  const publish = () => { if (!destroyed) hooks.render({ ...state, fields: { ...state.fields } }); };
  const writable = () => !destroyed && hooks.isOpen() && !!state.settings && state.settings.canManage !== false && !state.busy;
  function showError(cause: unknown) {
    const value = (cause || {}) as { status?: number; code?: string; message?: string };
    const messages: Record<string, string> = { AI_HOST_RESTART_REQUIRED: '后端文件已更新，请保存作答并重启应用服务，再保存 AI 设置。', AI_SETTINGS_SAVE_FAILED: 'AI 设置未能保存，请重启应用服务后重试。', INTERNAL_ERROR: 'AI 操作发生内部错误，请保存作答并重启应用服务后重试。' };
    state.error = value.status === 404 || value.code === 'NOT_FOUND' ? '当前服务未提供新版 AI 设置接口。请保存作答，关闭原启动窗口后重新启动。' : messages[value.code || ''] || value.message || 'AI 设置操作失败，请重试';
  }
  function apply(value: AiSettings) {
    // Allowlist also prevents unexpected credentials returned by an old host from entering props.
    state.fields = fieldsOnly(value);
    state.settings = { ...state.fields, canManage: value.canManage, apiKeyConfigured: !!value.apiKeyConfigured };
    state.hub = value.hub ?? state.hub; state.report = reportOnly(value.testReport); state.status = describe(state.settings);
    if (value.canManage === false) hooks.writeKey('');
  }
  function deactivate() {
    if (destroyed) return;
    ++epoch; config.login.cancel(); hooks.writeKey(''); state.busy = false; state.testing = false; publish();
  }
  async function patch(body: Partial<AiFields>, revert?: () => void, done?: string) {
    if (!writable()) return;
    const token = epoch; state.busy = true; state.error = ''; state.status = '正在保存…'; publish();
    try { const value = await config.request(PATH, { method: 'PUT', body: JSON.stringify(body) }); if (live(token)) { apply({ ...value as AiSettings, hub: state.hub }); if (done) state.status = done; } }
    catch (cause) { if (live(token)) { revert?.(); state.status = '设置未保存，请重试。'; showError(cause); } }
    finally { if (live(token)) { state.busy = false; publish(); } }
  }
  async function loginThenEnable() {
    const token = epoch; state.busy = true; state.error = ''; state.status = '请在浏览器中登录 QuizForge 账号…'; publish();
    let account: HubAccount | null = null;
    try { account = await config.login.login(); }
    catch (cause) { if (live(token)) showError(cause); }
    if (!live(token)) return;
    state.busy = false;
    if (!account?.connected) { state.fields.useOfficial = false; state.status = '没有登录，未开启免费 AI 额度。'; publish(); return; }
    state.hub = account;
    await patch({ useOfficial: true }, () => { state.fields.useOfficial = false; }, '已登录，免费 AI 额度已开启。');
  }
  async function saveCurrent(token: number) {
    const key = hooks.readKey();
    const body = { ...state.fields, baseUrl: state.fields.baseUrl.trim(), model: state.fields.model.trim(), ...(key ? { apiKey: key } : { clearApiKey: true }) };
    const value = await config.request(PATH, { method: 'PUT', body: JSON.stringify(body) });
    if (live(token)) apply({ ...value as AiSettings, hub: state.hub });
  }
  const actions = {
    initialize: publish,
    deactivate,
    async open() {
      if (destroyed || state.busy) return;
      const token = ++epoch; hooks.show(); hooks.writeKey('');
      state = { settings: null, fields: fieldsOnly({}), hub: { connected: false }, busy: true, testing: false, status: '正在读取 AI 设置…', error: '', report: null }; publish();
      try {
        const value = await config.request(PATH) as AiSettings; if (!live(token)) return;
        const credential = value.canManage === false ? null : await config.request(`${PATH}/credential`) as { apiKey?: string }; if (!live(token)) return;
        apply(value); hooks.writeKey(credential?.apiKey || '');
        if (value.canManage !== false && value.hub?.connected) {
          const initialHub = state.hub;
          void config.request(`${PATH}/hub`).then(account => { if (live(token) && state.hub === initialHub) { state.hub = account as HubAccount; publish(); } }, () => {});
        }
      } catch (cause) { if (live(token)) showError(cause); }
      finally { if (live(token)) { state.busy = false; publish(); } }
    },
    edit() {
      if (!writable()) return;
      state.fields = fieldsOnly(hooks.readFields()); state.report = null; state.status = '配置有修改，点“保存”后生效。'; publish();
    },
    async toggle(name: 'enabled' | 'autoGrade' | 'useOfficial' | 'useCustom') {
      if (!writable()) return;
      state.fields = fieldsOnly(hooks.readFields()); const checked = state.fields[name];
      if (name === 'useCustom' && checked && !(state.settings?.baseUrl && state.settings?.model)) { state.status = '填写服务地址和模型名称后点“保存”，即可使用自定义模型。'; publish(); return; }
      if (name === 'useCustom' && !checked && !state.settings?.useCustom) { state.status = describe(state.settings!); publish(); return; }
      if (name === 'useOfficial' && checked && !state.hub.connected) { await loginThenEnable(); return; }
      await patch({ [name]: checked }, () => { state.fields[name] = !checked; });
    },
    async save() {
      if (!writable()) return;
      state.fields = fieldsOnly(hooks.readFields()); const token = epoch; state.error = ''; state.busy = true; state.status = '正在保存 AI 设置…'; publish();
      try { await saveCurrent(token); if (live(token)) state.status = 'AI 设置已保存。'; }
      catch (cause) { if (live(token)) { state.status = 'AI 设置未保存，当前修改保留，请重试。'; showError(cause); } }
      finally { if (live(token)) { state.busy = false; publish(); } }
    },
    async test() {
      if (!writable()) return;
      state.fields = fieldsOnly(hooks.readFields()); if (!state.fields.baseUrl.trim() || !state.fields.model.trim()) return;
      const token = epoch; let saved = false; state.busy = true; state.testing = true; state.error = ''; state.report = null; state.status = '正在保存当前配置…'; publish();
      try {
        await saveCurrent(token); saved = true; if (!live(token)) return;
        state.status = '正在测试文字响应、评分输出和图片识别…'; state.report = null; publish();
        const value = await config.request(`${PATH}/test`, { method: 'POST', body: '{}', timeoutMs: 135000 }) as TestReport & { settings?: AiSettings };
        if (live(token)) { if (value.settings) apply({ ...value.settings, hub: state.hub, canManage: true }); state.report = reportOnly(value); state.status = '模型测试已完成，结果见下方报告。'; }
      } catch (cause) { if (live(token)) { state.status = saved ? '配置已保存，但模型测试未完成。' : 'AI 设置未保存，模型测试未执行。'; showError(cause); } }
      finally { if (live(token)) { state.busy = false; state.testing = false; publish(); } }
    },
    close() { if (!destroyed) { deactivate(); hooks.close(); } },
    destroy() { if (destroyed) return; deactivate(); destroyed = true; },
  };
  return actions;
}
export type AiActions = ReturnType<typeof createAiSettings>;
