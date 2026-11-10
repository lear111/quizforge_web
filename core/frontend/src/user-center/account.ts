export interface Account {
  connected: boolean; expired?: boolean; unavailable?: boolean; user?: { name: string }; device?: { name: string };
  ai?: { enabled: boolean; balance: number }; manageUrl?: string;
}
export interface UserState { account: Account | null; busy: boolean; status: string; error: string; result: string; resultError: boolean }
export interface UserConfig {
  request(path: string, options?: { method: string; body: string }): Promise<unknown>;
  login: { login(): Promise<Account | null>; cancel(): void };
}
export interface UserHooks {
  render(state: UserState): void; readCode(): string; clearCode(): void;
  isOpen(): boolean; show(): void; close(): void; openContact(): void; closeContact(): void;
}
const HUB = '/api/settings/ai/hub';
export const yuan = (amount: number) => '¥' + (Math.floor(Number(amount || 0) / 100) / 100).toFixed(2);
// Never pass tokens, full API replies or redeem-code input into Vue props.
const accountOnly = (value: Account): Account => ({ connected: !!value.connected, expired: !!value.expired, unavailable: !!value.unavailable,
  user: value.user ? { name: value.user.name } : undefined, device: value.device ? { name: value.device.name } : undefined,
  ai: value.ai ? { enabled: !!value.ai.enabled, balance: value.ai.balance } : undefined, manageUrl: value.manageUrl });
export function balance(value: Account | null) {
  return value?.unavailable ? '暂时查询不到' : value?.ai ? value.ai.enabled ? yuan(value.ai.balance) : `${yuan(value.ai.balance)} · 暂不可用` : '—';
}
export function createUserCenter(config: UserConfig, hooks: UserHooks) {
  let state: UserState = { account: null, busy: false, status: '正在读取账号…', error: '', result: '', resultError: false };
  let epoch = 0, destroyed = false;
  const live = (token: number) => !destroyed && token === epoch && hooks.isOpen();
  const publish = () => { if (!destroyed) hooks.render({ ...state }); };
  const ready = () => !destroyed && hooks.isOpen() && !state.busy && !!state.account;
  const showError = (cause: unknown) => { state.error = (cause as { message?: string })?.message || '操作没有完成，请重试。'; };
  function apply(value: Account) {
    state.account = accountOnly(value); state.status = value.connected && value.unavailable ? '暂时无法连接 QuizForge 服务器，余额可能不是最新。' : !value.connected && value.expired ? '登录已失效，请重新登录 QuizForge 账号。' : '';
  }
  async function load(token: number) { const value = await config.request(HUB) as Account; if (live(token)) apply(value); }
  async function run(task: (token: number) => Promise<void>) {
    if (!ready()) return;
    const token = epoch; state.busy = true; state.error = ''; publish();
    try { await task(token); } catch (cause) { if (live(token)) showError(cause); }
    finally { if (live(token)) { state.busy = false; publish(); } }
  }
  function deactivate() {
    if (destroyed) return;
    ++epoch; config.login.cancel(); hooks.closeContact(); state.busy = false; publish();
  }
  const actions = {
    initialize: publish, deactivate,
    async open() {
      if (destroyed || state.busy) return;
      const token = ++epoch; hooks.show();
      state = { account: null, busy: true, status: '正在读取账号…', error: '', result: '', resultError: false }; publish();
      try { await load(token); }
      catch (cause) {
        if (!live(token)) return;
        if ((cause as { code?: string })?.code === 'LOCAL_SETTINGS_ONLY') state.status = '用户中心只能在运行 QuizForge 的电脑上查看和登录。手机等设备评分时使用电脑上的账号和额度。';
        else { showError(cause); state.status = '读取账号失败。'; }
      } finally { if (live(token)) { state.busy = false; publish(); } }
    },
    editCode() { if (ready()) { state.result = ''; state.resultError = false; publish(); } },
    async redeem() {
      if (!ready() || !state.account?.connected) return;
      const input = hooks.readCode().trim();
      if (!input) { state.result = '请输入兑换码。'; state.resultError = true; publish(); return; }
      await run(async token => {
        state.result = ''; state.resultError = false; publish();
        try {
          const added = await config.request(`${HUB}/redeem`, { method: 'POST', body: JSON.stringify({ code: input }) }) as { added: number; balance: number };
          if (!live(token)) return;
          hooks.clearCode(); state.result = `已兑换 ${yuan(added.added)}，当前剩余 ${yuan(added.balance)}。`;
          state.account = { ...state.account!, ai: { ...(state.account?.ai || { enabled: true }), balance: added.balance } };
        } catch (cause) {
          if (!live(token)) return;
          state.result = (cause as { message?: string })?.message || '兑换没有完成，请重试。'; state.resultError = true;
          if ((cause as { code?: string })?.code === 'HUB_LOGIN_REQUIRED') await load(token);
        }
      });
    },
    refresh() { return run(load); },
    logout() { return run(async token => { const value = await config.request(`${HUB}/logout`, { method: 'POST', body: '{}' }) as Account; if (live(token)) { apply(value); state.status = '已退出登录。免费 AI 额度需要重新登录后才能使用。'; } }); },
    login() { return run(async token => { const value = await config.login.login(); if (live(token) && value?.connected) apply(value); }); },
    contact() { if (!destroyed && hooks.isOpen() && state.account) hooks.openContact(); },
    close() { if (!destroyed) { deactivate(); hooks.close(); } },
    destroy() { if (destroyed) return; deactivate(); hooks.clearCode(); destroyed = true; },
  };
  return actions;
}
export type UserActions = ReturnType<typeof createUserCenter>;
