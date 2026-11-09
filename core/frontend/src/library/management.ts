import type { LibraryItem } from './types';

export type Target = 'group' | 'item';
export type Action = 'create' | 'update' | 'delete';
export interface Operation { kind: string; target: Target; action: Action; path: string; name?: string; group?: string }
export interface Draft { name: string; group: string }
export interface ManagementConfig {
  getContext(): { kind: string; catalog: { canManage?: boolean; groups?: { banks?: string[]; extensions?: string[] }; banks?: LibraryItem[]; documents?: LibraryItem[] } };
  request(path: string, options: { method: string; body: string; timeoutMs: number }): Promise<unknown>;
  beforeChange(operation: Operation): unknown | Promise<unknown>;
  onChanged(result: unknown, operation: Operation): unknown | Promise<unknown>;
  onExport?(row: LibraryItem, target: Target): unknown | Promise<unknown>;
}
export interface ManagementState extends Draft {
  title: string; hint: string; status: string; error: string; busy: boolean;
  removing: boolean; readOnly: boolean; creatingGroup: boolean; groupVisible: boolean;
  moreVisible: boolean; exportVisible: boolean; exportLabel: string; groups: string[];
}
export interface ManagementView {
  render(state: ManagementState): void;
  show(focus: 'name' | 'cancel'): void;
  close(): void;
}
const message = (cause: unknown) => cause && typeof cause === 'object' && 'message' in cause ? String(cause.message) : '操作失败，请重试。';

// Only the current directory row and form draft are kept here, never a reactive
// copy of a bank, answer frame, history, or extension implementation.
export function createLibraryManagement(config: ManagementConfig, view: ManagementView) {
  let operation: Operation | null = null, subject: LibraryItem = {};
  let returnEdit: { target: Target; row: LibraryItem; draft: Draft } | null = null;
  let epoch = 0, disposed = false;
  const state: ManagementState = { name: '', group: '', title: '编辑目录', hint: '', status: '', error: '', busy: false,
    removing: false, readOnly: false, creatingGroup: false, groupVisible: false, moreVisible: false,
    exportVisible: false, exportLabel: '导出题库', groups: [] };
  const update = () => { if (!disposed) view.render({ ...state }); };
  const active = (token: number) => !disposed && token === epoch;
  const edit = (draft: Draft) => { if (!disposed && !state.busy) Object.assign(state, draft); };
  function open(target: Target, row?: LibraryItem | null, action: Action = 'update', draft?: Draft) {
    if (disposed || state.busy) return;
    const { kind, catalog } = config.getContext();
    if (!catalog.canManage || kind === 'extension' && action === 'create') return;
    epoch++; operation = { kind, target, action, path: row?.path || '' }; subject = { ...row }; returnEdit = null;
    const type = target === 'group' ? (kind === 'extension' ? '拓展分组' : '分组') : kind === 'bank' ? '题库' : '拓展';
    const removing = action === 'delete', readOnly = kind === 'extension' && !removing;
    const mixedGroup = kind === 'bank' && target === 'group' && (catalog.documents || []).some(item => item.group === row?.path);
    const hint = removing
      ? `${row?.title || row?.name || row?.path}：${target === 'group' ? '此分组及其全部内容（包括未显示的文件）' : '此' + type}将移入 .trash/library 回收目录，作答与历史数据保留。${kind === 'extension' ? '仍有题库引用时无法删除。' : ''}`
      : target === 'group' ? '分组名就是文件夹名；改名不会重置作答与历史。' : '名称对应实际文件夹或文件名，移动或改名不会重置作答与历史。';
    const groups = target === 'group' ? [] : (catalog.groups?.[kind === 'bank' ? 'banks' : 'extensions'] || []).filter(path => !path.includes('/') && !path.includes('\\'));
    const group = target === 'group' ? '' : row?.group || '';
    Object.assign(state, {
      title: `${removing ? '删除' : action === 'create' ? '新建' : readOnly ? '管理' : '编辑'}${type}`,
      name: target === 'group' ? row?.name || '' : row?.title || row?.name || '',
      group: groups.includes(group) ? group : '', groups, removing, readOnly,
      creatingGroup: target === 'group' && action === 'create', groupVisible: target !== 'group',
      hint: readOnly ? `${row?.name || row?.title || row?.path}：拓展按实际路径引用，不支持改名或移动。可在下方删除；仍有题库引用时无法删除。`
        : hint + (removing && kind === 'bank' ? ' 配套拓展文件会保留，不随题库删除。' : '')
          + (!removing && mixedGroup ? ' PDF、Word 与题库共用此分组；.qbank 导出题库及配套资源，文档请在编辑文档中单独导出。' : ''),
      moreVisible: action === 'update',
      exportVisible: kind === 'bank' && Boolean(config.onExport) && (!mixedGroup || (catalog.banks || []).some(item => item.group === row?.path)),
      exportLabel: target === 'group' && !mixedGroup ? '导出分组' : '导出题库', error: '', status: '',
    });
    if (draft) Object.assign(state, draft);
    update(); view.show(removing || readOnly ? 'cancel' : 'name');
  }
  function close() { if (!disposed && !state.busy) { epoch++; view.close(); } }
  function cancel() {
    if (disposed || state.busy) return;
    if (returnEdit) { const previous = returnEdit; open(previous.target, previous.row, 'update', previous.draft); }
    else close();
  }
  function remove(draft: Draft) {
    if (disposed || state.busy || operation?.action !== 'update') return;
    const previous = { target: operation.target, row: subject, draft: { ...draft } };
    open(previous.target, previous.row, 'delete'); returnEdit = previous;
  }
  async function exportSaved(draft: Draft) {
    if (disposed || state.busy || operation?.action !== 'update' || operation.kind !== 'bank' || !config.onExport || !state.exportVisible) return;
    edit(draft); const token = epoch, row = subject, target = operation.target;
    state.busy = true; state.error = ''; state.status = '正在导出已保存的内容…'; update();
    try {
      if (await config.onExport(row, target) === false) throw new Error('正在导入或导出，请稍后重试。');
      if (active(token)) state.status = '已导出当前保存的内容。';
    } catch (cause) { if (active(token)) { state.status = ''; state.error = message(cause); } }
    finally { if (active(token)) { state.busy = false; update(); } }
  }
  async function submit(draft: Draft) {
    if (disposed || state.busy || !operation || operation.kind === 'extension' && operation.action !== 'delete') return;
    edit(draft); const value = { ...operation }, token = epoch;
    if (value.action !== 'delete') {
      value.name = state.name.trim(); value.group = value.target === 'group' ? '' : state.group;
      if (!value.name) { state.error = '请输入名称'; update(); return; }
    }
    state.busy = true; state.error = ''; state.status = ''; update();
    try {
      await config.beforeChange(value); if (!active(token)) return;
      const result = await config.request('/api/library/manage', { method: 'POST', body: JSON.stringify(value), timeoutMs: 60000 });
      if (!active(token)) return;
      await config.onChanged(result, value); if (active(token)) view.close();
    } catch (cause) { if (active(token)) state.error = message(cause); }
    finally { if (active(token)) { state.busy = false; update(); } }
  }
  return { state, open, edit, close, cancel, remove, exportSaved, submit,
    closed() { if (disposed) return; epoch++; operation = null; subject = {}; returnEdit = null; state.busy = false; },
    destroy() { disposed = true; epoch++; operation = null; subject = {}; returnEdit = null; },
  };
}
export type LibraryManagement = ReturnType<typeof createLibraryManagement>;
