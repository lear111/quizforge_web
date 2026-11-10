export interface DevelopmentSettings { enabled: boolean; canManage?: boolean }
export interface DevelopmentState { settings: DevelopmentSettings | null; checked: boolean; busy: boolean; status: string; error: string }
export interface DevelopmentConfig {
  request(path: string, options?: { method: string; body: string }): Promise<DevelopmentSettings>;
  beforeSave?(settings: { enabled: boolean }): unknown;
  onSaved?(settings: DevelopmentSettings): unknown;
}
export interface DevelopmentHooks { render(state: DevelopmentState): void; isOpen(): boolean; show(): void; close(): void }
const PATH = '/api/settings/development';
export function createDevelopmentSettings(config: DevelopmentConfig, hooks: DevelopmentHooks) {
  let state: DevelopmentState = { settings: null, checked: false, busy: false, status: '', error: '' };
  let destroyed = false, epoch = 0, saving: Promise<void> | null = null;
  const live = (token: number) => !destroyed && epoch === token && hooks.isOpen();
  const publish = () => { if (!destroyed) hooks.render({ ...state }); };
  function apply(value: DevelopmentSettings) {
    state.settings = { enabled: !!value.enabled, canManage: value.canManage }; state.checked = !!value.enabled;
    state.status = value.canManage === false ? '拓展管理入口只能在运行 QuizForge 的电脑上修改。' : '';
  }
  function showError(cause: unknown) {
    const value = (cause || {}) as { code?: string; message?: string };
    if (value.code === 'NOT_FOUND') { state.status = '当前服务尚未提供拓展管理设置接口。'; state.error = '请先保存作答，关闭原启动窗口后重新启动 QuizForge，再刷新页面。'; }
    else {
      if (!state.settings) state.status = '读取拓展管理设置失败。';
      state.error = value.code === 'LOCAL_SETTINGS_ONLY' ? '请在运行 QuizForge 的电脑上修改拓展管理设置。' : value.message || '拓展管理设置操作失败，请重试。';
    }
  }
  function deactivate() { if (!destroyed) { ++epoch; state.busy = false; publish(); } }
  const actions = {
    initialize: publish, deactivate,
    async open() {
      if (destroyed || (state.busy && hooks.isOpen())) return;
      const token = ++epoch; hooks.show(); state.settings = null; state.busy = true; state.error = ''; state.status = '正在读取拓展管理设置…'; publish();
      try {
        // Tab changes do not cancel an accepted save. Read only after its
        // preparation, PUT and catalog refresh have settled.
        await saving; if (!live(token)) return;
        const value = await config.request(PATH); if (live(token)) apply(value);
      } catch (cause) { if (live(token)) showError(cause); }
      finally { if (live(token)) { state.busy = false; publish(); } }
    },
    async save(desired: boolean) {
      if (destroyed || !hooks.isOpen() || state.busy || saving || !state.settings || state.settings.canManage === false) { publish(); return; }
      if (desired === state.settings.enabled) { state.checked = desired; publish(); return; }
      const token = epoch; let next = state.settings;
      state.checked = desired; state.busy = true; state.error = ''; state.status = '正在保存…'; publish();
      const task = (async () => {
        try {
          await config.beforeSave?.({ enabled: desired }); if (destroyed) return;
          next = await config.request(PATH, { method: 'PUT', body: JSON.stringify({ enabled: desired }) }); if (destroyed) return;
          await config.onSaved?.(next); if (live(token)) apply(next);
        } catch (cause) { if (live(token)) { apply(next); showError(cause); } }
        finally { if (live(token)) { state.busy = false; publish(); } }
      })();
      saving = task; await task; if (saving === task) saving = null;
    },
    close() { if (!destroyed) { deactivate(); hooks.close(); } },
    destroy() { if (destroyed) return; ++epoch; destroyed = true; },
  };
  return actions;
}
export type DevelopmentActions = ReturnType<typeof createDevelopmentSettings>;
