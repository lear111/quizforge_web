export interface HttpsSettings {
  enabled?: boolean; configured?: boolean; port?: number; urls?: string[]; certificateUrls?: string[];
  certificateQr?: string; urlQr?: string; fingerprint?: string; rootValidTo?: string; serverValidTo?: string;
}
export interface NetworkSettings {
  canManage?: boolean; enabled: boolean; publicEnabled?: boolean; publicUrl?: string; port: number;
  passwordConfigured: boolean; urls?: string[]; publicIpv6Urls?: string[]; ipv6Supported?: boolean;
  tailscale?: { state: string; url?: string }; https?: HttpsSettings; error?: string;
}
export interface NetworkFields { enabled: boolean; publicEnabled: boolean; publicUrl: string; port: string; httpsEnabled: boolean; httpsPort: string }
export interface NetworkDraft extends NetworkFields { password: string }
export interface NetworkState {
  settings: NetworkSettings | null; fields: NetworkFields; loading: boolean; saving: boolean; refreshing: boolean;
  status: string; error: string; httpsStatus: string;
}
export interface NetworkConfig {
  request(path: string, options?: { method: string; body: string }): Promise<NetworkSettings>;
  beforeSave?(): unknown; onSaved?(settings: NetworkSettings): unknown;
  confirm?(message: string): boolean;
}
export interface NetworkHooks {
  render(state: NetworkState): void; readFields(): NetworkFields; readDraft(): NetworkDraft; clearPassword(): void;
  focus(target: 'password' | 'public-url' | 'https-port'): void;
  isOpen(): boolean; show(): void; close(): void;
}
const PATH = '/api/settings/network';
const PUBLIC_URL_MESSAGE = '自定义地址请填写根地址，如 http://quiz.example.com:8788/ 或 http://[IPv6地址]:端口/，不包含路径、账号或查询参数。';
export const connectionStatus = (next: NetworkSettings) => {
  const modes = [next.enabled ? '局域网' : null, next.publicEnabled ? '外网' : null].filter(Boolean);
  return modes.length ? `${modes.join('和')}连接已开启。` : '网络连接已关闭，仅本机可以访问。';
};
const httpsStatus = (info: HttpsSettings | undefined) => info?.enabled ? '局域网 HTTPS 已开启。首次使用请按下面步骤在手机上安装并信任根证书。' :
  info?.configured ? '局域网 HTTPS 已开启但端口未能启动，请换一个 HTTPS 端口后保存。' : '开启后，首次会在这台电脑生成只用于 QuizForge 的本机根证书。';
const emptyFields = (): NetworkFields => ({ enabled: false, publicEnabled: false, publicUrl: '', port: '', httpsEnabled: false, httpsPort: '' });
const fieldsOnly = ({ enabled, publicEnabled, publicUrl, port, httpsEnabled, httpsPort }: NetworkDraft | NetworkFields): NetworkFields => ({ enabled, publicEnabled, publicUrl, port, httpsEnabled, httpsPort });

// Passwords are captured only for a submission, never published in render state.
export function createNetworkSettings(config: NetworkConfig, hooks: NetworkHooks) {
  let state: NetworkState = { settings: null, fields: emptyFields(), loading: false, saving: false, refreshing: false, status: '正在读取设置…', error: '', httpsStatus: '' };
  let destroyed = false, epoch = 0;
  const live = (revision: number) => !destroyed && revision === epoch && hooks.isOpen();
  const publish = () => { if (!destroyed) hooks.render({ ...state, fields: { ...state.fields } }); };
  const writable = () => !!state.settings && state.settings.canManage !== false;
  function showError(cause: unknown) {
    const value = cause && typeof cause === 'object' ? cause as { code?: string; message?: string } : {};
    const messages: Record<string, string> = { LOCAL_SETTINGS_ONLY: '网络设置只能在本机修改。请在运行 QuizForge 的电脑上打开本机地址。', LAN_SETTINGS_UNAVAILABLE: '端口被占用或设置保存失败，当前连接保留。', INVALID_NETWORK_SETTINGS: '请检查连接端口、密码和自定义地址。', INVALID_PUBLIC_URL: PUBLIC_URL_MESSAGE, HTTPS_DISABLED: '请先开启并保存局域网 HTTPS。' };
    state.error = messages[value.code || ''] || value.message || '设置操作失败，请重试。';
  }
  function apply(next: NetworkSettings) {
    state.settings = next;
    state.fields = { enabled: !!next.enabled, publicEnabled: !!next.publicEnabled, publicUrl: next.publicUrl || '', port: String(next.port), httpsEnabled: !!(next.https?.configured && next.enabled), httpsPort: String(next.https?.port ?? '') };
    state.status = next.canManage === false ? '请在运行 QuizForge 的电脑上修改设置。' : connectionStatus(next);
    state.httpsStatus = httpsStatus(next.https);
    if (next.error) showError(new Error(next.error));
    else if (typeof next.publicEnabled !== 'boolean') showError(new Error('当前服务尚不支持外网连接。请保存作答，关闭原服务并重新启动。'));
  }
  function closed() {
    if (destroyed) return;
    ++epoch; state.loading = false; state.refreshing = false; state.saving = false;
    hooks.clearPassword(); publish();
  }
  const actions = {
    get saving() { return state.saving; },
    initialize() { publish(); },
    edit(fields: NetworkFields) {
      if (destroyed || state.loading || state.saving || !writable()) return;
      state.fields = fieldsOnly(fields); if (!fields.enabled) state.fields.httpsEnabled = false; publish();
    },
    close() { if (destroyed || state.saving) return; closed(); hooks.close(); },
    closed,
    async open() {
      if (destroyed || hooks.isOpen() || state.saving) return;
      const revision = ++epoch;
      state = { settings: null, fields: emptyFields(), loading: true, saving: false, refreshing: false, status: '正在读取设置…', error: '', httpsStatus: '' };
      hooks.clearPassword(); publish(); hooks.show();
      try { const next = await config.request(PATH); if (live(revision)) apply(next); }
      catch (cause) { if (live(revision)) { state.status = '无法读取网络设置。'; showError(cause); } }
      finally { if (live(revision)) { state.loading = false; publish(); } }
    },
    async refresh() {
      if (destroyed || state.loading || state.saving || state.refreshing || !writable()) return;
      const revision = epoch;
      state.fields = fieldsOnly(hooks.readFields()); state.refreshing = true; state.error = ''; publish();
      try {
        const next = await config.request(`${PATH}?refresh=1`);
        if (live(revision)) {
          // Address discovery must not reset even the unsaved HTTPS fields.
          state.settings = { ...state.settings!, urls: next.urls, publicIpv6Urls: next.publicIpv6Urls, tailscale: next.tailscale, ipv6Supported: next.ipv6Supported, https: next.https };
          state.httpsStatus = httpsStatus(next.https);
        }
      } catch (cause) { if (live(revision)) showError(cause); }
      finally { if (live(revision)) { state.refreshing = false; publish(); } }
    },
    async save() {
      if (destroyed || state.loading || state.saving || !writable() || !hooks.isOpen()) return;
      const draft = hooks.readDraft(); state.fields = fieldsOnly(draft); state.error = '';
      const fail = (message: string, target?: 'password' | 'public-url' | 'https-port') => { showError(new Error(message)); publish(); if (target) hooks.focus(target); };
      const port = Number(draft.port), hasPassword = !!draft.password.trim();
      if (!Number.isInteger(port) || port < 1024 || port > 65535) { fail('端口需要填写 1024–65535 之间的整数。'); return; }
      if ((hasPassword && (draft.password.length < 8 || draft.password.length > 256)) || ((draft.enabled || draft.publicEnabled) && !state.settings!.passwordConfigured && !hasPassword)) {
        fail('首次开启需要设置密码，密码长度为 8–256 个字符。', 'password'); return;
      }
      const publicUrl = draft.publicUrl.trim();
      if (publicUrl) {
        try { const address = new URL(publicUrl); if (!['http:', 'https:'].includes(address.protocol) || address.username || address.password || address.pathname !== '/' || address.search || address.hash) throw new Error(); }
        catch { fail(PUBLIC_URL_MESSAGE, 'public-url'); return; }
      }
      const body: { enabled: boolean; publicEnabled: boolean; publicUrl: string; port: number; httpsEnabled?: boolean; httpsPort?: number; password?: string } = { enabled: draft.enabled, publicEnabled: draft.publicEnabled, publicUrl, port };
      if (state.settings!.https) {
        const httpsPort = Number(draft.httpsPort);
        if (!Number.isInteger(httpsPort) || httpsPort < 1024 || httpsPort > 65535 || (draft.enabled && draft.httpsEnabled && httpsPort === port)) { fail('HTTPS 端口需要填写 1024–65535 之间的整数，且不能与连接端口相同。', 'https-port'); return; }
        body.httpsEnabled = draft.enabled && draft.httpsEnabled; body.httpsPort = httpsPort;
      }
      if (hasPassword) body.password = draft.password;
      // A write supersedes any pending address discovery.
      const revision = ++epoch; state.refreshing = false; state.saving = true; publish();
      try {
        await config.beforeSave?.(); if (!live(revision)) return;
        const next = await config.request(PATH, { method: 'PUT', body: JSON.stringify(body) });
        if (!live(revision)) return;
        hooks.clearPassword(); apply(next); if (!next.error) state.status = `已保存，${connectionStatus(next)}`;
        publish(); await config.onSaved?.(next);
      } catch (cause) { if (live(revision)) showError(cause); }
      finally { if (live(revision)) { state.saving = false; publish(); } }
    },
    async regenerate() {
      if (destroyed || state.loading || state.saving || !writable() || !state.settings?.https?.enabled || !hooks.isOpen()) return;
      if (config.confirm && !config.confirm('重新生成根证书后，已安装旧证书的手机都要删除旧证书并重新安装新证书。确定继续吗？')) return;
      const revision = ++epoch; state.refreshing = false; state.error = ''; state.saving = true; publish();
      try {
        const next = await config.request(`${PATH}/https/regenerate`, { method: 'POST', body: '{}' });
        if (!live(revision)) return;
        apply(next); if (!next.error) state.httpsStatus = '已重新生成根证书。请在手机上删除旧的 QuizForge 证书，再按下面步骤安装新证书。';
      } catch (cause) { if (live(revision)) showError(cause); }
      finally { if (live(revision)) { state.saving = false; publish(); } }
    },
    destroy() { if (destroyed) return; ++epoch; destroyed = true; hooks.clearPassword(); },
  };
  return actions;
}
export type NetworkActions = ReturnType<typeof createNetworkSettings>;

export function connectionRows(next: NetworkSettings | null) {
  const keys = ['lan', 'ipv6', 'custom', 'tailscale'] as const;
  const rows = Object.fromEntries(keys.map(key => [key, { urls: [] as string[], note: '', muted: false }])) as Record<typeof keys[number], { urls: string[]; note: string; muted: boolean }>;
  if (!next) return rows;
  const strings = (list?: string[]) => (list || []).filter(item => typeof item === 'string' && item);
  const outside = !!next.publicEnabled, off = '开启“外网连接”后可用';
  const secure = next.https?.enabled && Array.isArray(next.https.urls) ? next.https.urls : [];
  const lan = strings(secure.length ? secure : next.urls).filter(item => !item.includes('['));
  rows.lan = { urls: next.enabled ? lan : [], note: next.enabled ? (lan.length ? '手机与电脑连接同一网络' : '未检测到局域网地址') : '开启“局域网连接”后可用', muted: !next.enabled || !lan.length };
  const ipv6 = strings(next.publicIpv6Urls);
  rows.ipv6 = { urls: outside ? ipv6 : [], note: next.ipv6Supported === false ? '这台电脑未启用 IPv6' : !ipv6.length ? '未检测到本机公网 IPv6' : outside ? '需要光猫和电脑防火墙放行 IPv6 入站' : off, muted: !outside || !ipv6.length };
  rows.custom = { urls: outside && next.publicUrl ? [next.publicUrl] : [], note: outside ? '需要端口映射、域名或反向代理；填写后保存' : off, muted: !outside };
  const ts = next.tailscale || { state: 'unavailable' };
  rows.tailscale = ['missing', 'unavailable'].includes(ts.state) ? { urls: [], note: '未检测到 Tailscale', muted: true } : ts.state !== 'running' ? { urls: [], note: 'Tailscale 未运行或未登录', muted: true } : { urls: outside && ts.url ? [ts.url] : [], note: outside ? '手机登录同一 Tailscale 账号并保持连接' : off, muted: !outside || !ts.url };
  return rows;
}
export const addressTexts = (value: unknown): string[] => Array.isArray(value) ? value.filter(item => typeof item === 'string') : [];
export const validQr = (value: unknown): value is string => typeof value === 'string' && value.startsWith('data:image/svg+xml;base64,');
export function validity(info: HttpsSettings | undefined) {
  const day = (value: string) => { const date = new Date(value); return Number.isNaN(date.getTime()) ? '' : `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; };
  const dates = [info?.rootValidTo ? `根证书有效期至 ${day(info.rootValidTo)}` : '', info?.serverValidTo ? `服务器证书有效期至 ${day(info.serverValidTo)}，局域网地址变化或临近到期时自动换发，手机无需重装` : ''].filter(Boolean);
  return dates.length ? dates.join('；') + '。' : '';
}
