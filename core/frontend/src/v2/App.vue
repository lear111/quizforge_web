<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, toRaw } from 'vue';
import LibraryList from '../library/LibraryList.vue';
import OutlinePanel from '../outline/OutlinePanel.vue';
import type { LibraryTree } from '../library/types';
import { buildV2Outline } from './outline';
import type { Item, State } from './outline';
import { answeredFromStatus, reportOutlineStatus } from '../../../shared/v2/answered.js';
import { mountQuestionPage } from './page';
import { createGradingService } from './grading';
import { saveGrade, recoverGrades } from './scoring';
import { createSaveController, attachSaveLifecycle, isSaveConflict, saveRecoveryMessage } from './save-policy';
import { createPageSourceCache } from './source-cache';
import { createWriteQueue } from './write-queue';
import { mountScratch } from './whiteboard';
import type { Picture } from './page';
const props = defineProps<{ nonce: string }>();
interface Question { bankId: string; questionId: string; snapshotId: string; question: unknown; solution: unknown; answer: unknown; ink: unknown; inkRevision: number; resources: { assetId: string; reference: string }[]; result: { score: number | null; parts: Record<string, number> | null; message: string | null } | null; submissionId: string | null; item: Item; extension: { artifactId: string }; state: State }
interface Overview { bank: { bankId: string; title: string }; snapshotId: string; outline: { title: string; items: Item[] }[]; states: State[]; initial: { question: Question | null; error: { message: string } | null }; notice?: string | null; pendingGrading: { question: Question | null; error: { message: string } | null }[] }
const groups = ref<LibraryTree[]>([]), overview = ref<Overview | null>(null), current = ref<Question | null>(null), container = ref<HTMLElement>();
const busy = ref(false), message = ref(''), loading = ref(''), drawer = ref<'library' | 'outline' | null>(null), token = ref(''), authRequired = ref(false);
const typeName = ref('题目'), saveStatus = ref('');
const recovering = ref(false), drafting = ref(false), viewport = ref<HTMLElement>(), stage = ref<HTMLElement>(), world = ref<HTMLElement>();
let scratch: ReturnType<typeof mountScratch> | null = null;
let answerVersion = 0, inkVersion = 0, savedAnswer = 0, savedInk = 0;
const queue = createWriteQueue();
const enqueue = queue.enqueue;
const LAST_BANK = 'quizforge.v2.last-bank';
const lastQuestions = new Map<string, string>();
function remember(q: Question) {
  lastQuestions.delete(q.bankId); lastQuestions.set(q.bankId, q.questionId);
  while (lastQuestions.size > 8) lastQuestions.delete(lastQuestions.keys().next().value!);
  try { localStorage.setItem(LAST_BANK, q.bankId); } catch { /* Storage disabled: last answered position still works. */ }
}
let page: ReturnType<typeof mountQuestionPage> | null = null, generation = 0;
let saver: ReturnType<typeof createSaveController<Record<string, unknown>>> | null = null;
async function response(route: string, options: RequestInit = {}) {
  const response = await fetch(route, { ...options, credentials: 'omit', referrerPolicy: 'no-referrer', headers: { ...options.headers, ...(token.value ? { 'x-quizforge-token': token.value } : {}) } });
  if (!response.ok) { const body = await response.json(); if (response.status === 401) { authRequired.value = true; sources.dispose(); } throw Object.assign(new Error(body.error?.message || '操作未完成。'), { code: body.error?.code, status: response.status }); }
  return response;
}
const json = async (route: string, options?: RequestInit) => (await response(route, options)).json();
const text = async (route: string, signal?: AbortSignal) => (await response(route, { signal })).text();
const sources = createPageSourceCache({ json: (route, signal) => json(route, { signal }), text });
const grader = createGradingService({ loadSource: (id, signal) => text(`/api/v2/extensions/${id}/files/grade-js`, signal), scriptNonce: props.nonce });
const base = (q: Question) => `/api/v2/banks/${q.bankId}/questions/${encodeURIComponent(q.questionId)}`;
const requestId = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), n => n.toString(16).padStart(2, '0')).join('');
const outlineModel = computed(() => buildV2Outline(overview.value?.outline ?? [], overview.value?.states ?? [], current.value?.questionId));
function update(q: Question, preserveStatus = false) {
  if (current.value?.bankId === q.bankId && current.value.questionId === q.questionId) {
    if (!Object.hasOwn(q, 'ink')) q = { ...q, ink: current.value.ink, inkRevision: current.value.inkRevision };
    if (preserveStatus) q = { ...q, state: { ...q.state, status: current.value.state.status } };
  }
  current.value = q; if (overview.value) overview.value.states = overview.value.states.map(s => s.questionId === q.questionId ? q.state : s);
}
const context = (question: Question) => { const q = toRaw(question); return { mode: 'practice' as const, question: q.question, answer: q.answer, solution: q.solution, result: q.result, item: q.item, locked: q.state.locked, can: { submit: !q.state.locked, retry: q.state.hasSavedAnswer }, appearance: { theme: 'light' as const } }; };
async function pictures(q: Question, has: (id: string) => boolean = () => false): Promise<Picture[]> {
  const references = new Set<string>();
  const visit = (value: unknown) => {
    if (Array.isArray(value)) { value.forEach(visit); return; }
    if (!value || typeof value !== 'object') return;
    const node = value as { type?: string; attrs?: { src?: unknown } };
    if (node.type === 'image' && typeof node.attrs?.src === 'string') references.add(node.attrs.src);
    Object.values(value).forEach(visit);
  };
  visit(q.question); if (q.state.locked) visit(q.solution);
  return (await Promise.all(q.resources.filter(asset => references.has(asset.reference) && !has(asset.assetId)).map(async asset => {
    let result: Response;
    try { result = await response(base(q) + `/assets/${asset.assetId}?snapshotId=${encodeURIComponent(q.snapshotId)}`); }
    catch (error) { if ((error as { status?: number }).status === 404) return null; throw error; }
    const type = result.headers.get('Content-Type')?.split(';')[0] ?? '';
    if (!type.startsWith('image/')) return null;
    return { ...asset, type, bytes: await result.arrayBuffer() };
  }))).filter((asset): asset is Picture => asset !== null);
}
async function flush() { scratch?.flush(); await saver?.flush(); await queue.drain(); }
function disposePage() { generation++; saver?.destroy(); saver = null; page?.destroy(); page = null; saveStatus.value = ''; answerVersion = inkVersion = savedAnswer = savedInk = 0; }
async function applyContext(q: Question) {
  const instance = page, mine = generation;
  update(q);
  if (instance) { const assets = await pictures(q, id => instance.hasResource(id)); if (mine === generation) await instance.update(context(q), assets); }
}
async function reloadAfterConflict(previous: Question, mine: number, error?: unknown): Promise<Question | null> {
  if (mine !== generation) return null;
  const isCurrent = () => current.value?.bankId === previous.bankId && current.value.questionId === previous.questionId;
  recovering.value = true;
  try {
    let latest: Question;
    try { latest = await json(base(previous) + `?snapshotId=${encodeURIComponent(previous.snapshotId)}`); }
    catch (error) {
      if (!isSaveConflict(error)) throw error;
      let value: Overview;
      try { value = await json(`/api/v2/banks/${previous.bankId}/overview`); }
      catch (error) {
        if (!isSaveConflict(error)) throw error;
        disposePage(); current.value = null; overview.value = null; sources.dispose();
        message.value = '本题或题库已移除，本地未保存内容已放弃，请选择其他题目。'; return null;
      }
      if (mine !== generation) return null;
      overview.value = value; sources.scope(previous.bankId, value.snapshotId, token.value);
      if (!value.states.some(state => state.questionId === previous.questionId)) {
        if (isCurrent()) { disposePage(); current.value = null; }
        message.value = '本题已移除，本地未保存内容已放弃，请选择其他题目。'; return null;
      }
      try { latest = await json(base(previous) + `?snapshotId=${encodeURIComponent(value.snapshotId)}`); }
      catch (error) {
        if (!isSaveConflict(error)) throw error;
        if (isCurrent()) { disposePage(); current.value = null; }
        message.value = '本题暂时不可用，本地未保存内容已放弃，请选择其他题目。'; return null;
      }
    }
    if (mine !== generation) return null;
    if (isCurrent()) {
      if (latest.snapshotId === previous.snapshotId && latest.extension.artifactId === previous.extension.artifactId) { await applyContext(latest); scratch?.load(latest.ink); }
      else await show(latest, false);
    } else if (overview.value?.bank.bankId === latest.bankId) overview.value.states = overview.value.states.map(state => state.questionId === latest.questionId ? latest.state : state);
    message.value = saveRecoveryMessage(error);
    return latest;
  } finally { recovering.value = false; }
}
async function show(q: Question, resume = true) {
  // Keep the current page and its input intact if fetching the next page fails.
  sources.scope(q.bankId, q.snapshotId, token.value);
  const [loaded, assets] = await Promise.all([sources.load(q.extension.artifactId), pictures(q)]);
  disposePage(); const mine = generation; update(q); typeName.value = loaded.name; await nextTick();
  if (mine !== generation || !container.value) return;
  const instance = mountQuestionPage(container.value, loaded, context(q), props.nonce, {
    title: loaded.name, resources: assets,
    onChanged(kind, answered) {
      if (mine !== generation) return;
      const active = current.value!;
      if (answered !== undefined && !active.state.locked) {
        try { update({ ...toRaw(active), state: { ...toRaw(active.state), status: reportOutlineStatus(answered, active.item, active.state.status) } }); }
        catch (error) { message.value = error instanceof Error ? error.message : '作答状态无效。'; return; }
      }
      answerVersion++; saver?.changed(kind);
    },
    async onSubmit() { if (mine !== generation || busy.value || recovering.value || current.value?.state.locked) throw Error('当前不允许提交。'); await submit(); },
    async onRetry() { if (mine !== generation || busy.value || recovering.value || !current.value?.state.hasSavedAnswer) throw Error('当前不允许重做。'); await retry(); }
  });
  page = instance;
  scratch?.load(q.ink);
  saver = createSaveController<Record<string, unknown>>({
    async read() {
      const active = current.value!, av = answerVersion, iv = inkVersion;
      const fields: Record<string, unknown> = {};
      if (av > savedAnswer) {
        const answer = active.state.locked ? undefined : await instance.answer();
        if (!active.state.locked) { fields.answer = answer; fields.answered = answeredFromStatus(toRaw(active.state.status)); }
      }
      return { fields, ink: iv > savedInk ? scratch?.getDraft() : undefined, av, iv };
    },
    prepare(value) {
      const fields = value.fields as Record<string, unknown>, av = value.av as number, iv = value.iv as number;
      const operation = (kind: string, fields: Record<string, unknown>, done: () => void) => queue.prepare(() => {
        const active = current.value!;
        return { route: base(active) + '/' + kind, body: JSON.stringify({ requestId: requestId(), snapshotId: active.snapshotId, ...(kind === 'ink' ? { expectedInkRevision: active.inkRevision } : { expectedRevision: active.state.revision }), ...fields }) };
      }, (route, body) => json(route, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body }), (saved: Question) => { if (mine === generation) { done(); update(kind === 'ink' ? { ...toRaw(current.value!), ink: value.ink, inkRevision: saved.inkRevision, state: saved.state } : saved, answerVersion > savedAnswer); } });
      const answer = Object.keys(fields).length ? operation('answer', fields, () => { savedAnswer = av; }) : async () => { savedAnswer = av; };
      const ink = value.ink !== undefined ? operation('ink', { ink: value.ink }, () => { savedInk = iv; }) : async () => {};
      let answerDone = false;
      return async () => {
        if (!answerDone) { await answer(); answerDone = true; }
        // Repaint only when the saved draft changes button permissions. Stop
        // new user input first, then round-trip the getters to drain older
        // changed messages. A newer edit cancels this repaint and saves next.
        if (mine === generation && av === answerVersion && !current.value!.state.locked && instance.can.retry !== context(current.value!).can.retry) {
          instance.frame.inert = true;
          try { await instance.answer(); if (mine === generation && av === answerVersion) await instance.update(context(current.value!)); }
          finally { instance.frame.inert = false; }
        }
        await ink();
      };
    },
    recovery: { accepts: isSaveConflict, reload: async error => { await reloadAfterConflict(q, mine, error); savedAnswer = answerVersion; savedInk = inkVersion; } },
    status(value) { if (mine === generation) { saveStatus.value = ({ unsaved: '未保存', saving: '正在保存', saved: '已保存', failed: '保存失败', recovered: '已载入最新内容' })[value]; if (value === 'saved') message.value = ''; } },
    error(error) { if (mine === generation) message.value = error instanceof Error ? error.message : '保存失败，请重试。'; }
  });
  await instance.ready;
  remember(q);
  if (resume && q.submissionId !== null && q.result === null) await grade(q);
}
async function run(label: string, action: () => Promise<void>) { if (busy.value) return; busy.value = true; loading.value = label; message.value = ''; try { await action(); } catch (error) { message.value = error instanceof Error ? error.message : '操作未完成。'; } finally { busy.value = false; loading.value = ''; } }
async function catalog() { await run('正在读取题库', async () => {
  const value = await json('/api/v2/catalog'); authRequired.value = false;
  groups.value = value.groups.map((g: { id: string; name: string; items: { bankId: string; title: string; error: { message: string } | null }[] }) => ({ kind: 'group', path: g.id, name: g.name, expanded: false, children: g.items.map(row => ({ kind: 'extension', row: { id: row.bankId, title: row.title, kind: 'bank', error: row.error ?? undefined } })) }));
}); }
async function openBank(_kind: string, id?: string) { if (!id) return; await run('正在打开题库', async () => {
  await flush();
  const value: Overview = await json(`/api/v2/banks/${id}/overview`);
  const remembered = lastQuestions.get(id);
  const initial = remembered && value.states.some(state => state.questionId === remembered) && remembered !== value.initial.question?.questionId
    ? await json(`/api/v2/banks/${id}/questions/${encodeURIComponent(remembered)}?snapshotId=${value.snapshotId}`) as Question : value.initial.question;
  const previous = overview.value;
  sources.dispose(); sources.scope(value.bank.bankId, value.snapshotId, token.value); overview.value = value; drawer.value = null;
  if (initial) {
    try { await show(initial, false); } catch (error) { if (current.value?.bankId !== value.bank.bankId) overview.value = previous; throw error; }
  } else { disposePage(); current.value = null; message.value = value.initial.error?.message ?? '题库没有题目。'; }
  if (value.notice) message.value = value.notice;
  await recoverGrades(value.pendingGrading.flatMap(pending => pending.question ? [pending.question] : []), score, async saved => {
    overview.value!.states = overview.value!.states.map(s => s.questionId === saved.questionId ? saved.state : s);
    if (saved.questionId === current.value?.questionId) { await flush(); if (current.value) await applyContext(current.value); }
  }, error => { message.value = error instanceof Error ? error.message : '部分题目暂未完成评分，请稍后重试。'; });
}); }
async function navigate(id: string) { if (!overview.value || id === current.value?.questionId && !page?.faulted) return; await run('正在打开题目', async () => { await flush(); const bank = overview.value; if (!bank) return; await show(await json(`/api/v2/banks/${bank.bank.bankId}/questions/${encodeURIComponent(id)}?snapshotId=${bank.snapshotId}`)); drawer.value = null; }); }
async function score(q: Question): Promise<Question> {
  // Browser postMessage cannot clone Vue proxies from the current-question ref.
  q = toRaw(q);
  try { return await saveGrade({ questionId: q.questionId, question: q.question, solution: q.solution, answer: q.answer, item: q.item },
    items => grader.grade(q.extension.artifactId, items),
    result => enqueue(async () => {
      const saved: Question = await json(base(q) + '/result', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: requestId(), snapshotId: q.snapshotId, submissionId: q.submissionId, expectedRevision: q.state.revision, source: 'grader', result }) });
      // Publish the new revision before releasing the shared write queue.
      if (current.value?.bankId === saved.bankId && current.value.questionId === saved.questionId) update(saved);
      return saved;
    })); }
  catch (error) { if (!isSaveConflict(error)) throw error; const latest = await reloadAfterConflict(q, generation, error); if (!latest) throw new Error('本题已移除，已放弃过期评分。'); return latest; }
}
async function grade(q: Question) {
  await flush();
  const active = current.value;
  if (active?.bankId === q.bankId && active.questionId === q.questionId) {
    await score(active); await flush();
    if (current.value?.bankId === q.bankId && current.value.questionId === q.questionId) await applyContext(current.value);
  }
}
async function submit() { if (!current.value || !page || current.value.state.locked) return; await run('正在提交并评分', async () => {
  await flush(); const q = current.value; if (!q || q.state.locked) return;
  const answer = await page!.answer();
  let saved: Question;
  try { saved = await enqueue(() => json(base(q) + '/submit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: requestId(), snapshotId: q.snapshotId, expectedRevision: q.state.revision, answer }) })); }
  catch (error) { if (!isSaveConflict(error)) throw error; await reloadAfterConflict(q, generation, error); return; }
  await applyContext(saved); await grade(saved);
}); }
const detach = attachSaveLifecycle(window, { get dirty() { return saver?.dirty ?? false; }, flush });
onMounted(async () => {
  if (viewport.value && stage.value && world.value) scratch = mountScratch(viewport.value, stage.value, world.value, {
    changed() { if (current.value) { inkVersion++; saver?.changed('ink'); } },
    error(error) { message.value = error.message; }
  });
  await catalog();
  try { const id = localStorage.getItem(LAST_BANK); if (id && groups.value.some(group => group.kind === 'group' && group.children.some(row => row.kind === 'extension' && row.row.id === id))) await openBank('bank', id); } catch { /* Private/disabled storage. */ }
});
onBeforeUnmount(() => { detach(); disposePage(); scratch?.destroy(); sources.dispose(); grader.dispose(); });
async function toggleDraft() { scratch?.flush(); drafting.value = !drafting.value; scratch?.setMode(drafting.value); }
async function refreshBank() { if (!overview.value) return; await run('正在刷新题库', async () => {
  await flush(); const active = current.value, bank = overview.value!;
  const value: Overview = await json(`/api/v2/banks/${bank.bank.bankId}/refresh`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...(active ? { questionId: active.questionId } : {}) }) });
  overview.value = value; sources.dispose();
  if (value.notice) message.value = value.notice;
  if (value.initial.question) await show(value.initial.question); else { disposePage(); current.value = null; scratch?.load(null); }
}); }
async function retry() { if (!current.value) return; await run('正在重做', async () => {
  await flush(); const q = current.value!;
  try {
    const saved = await enqueue(() => json(base(q) + '/retry', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: requestId(), snapshotId: q.snapshotId, expectedRevision: q.state.revision }) }));
    await applyContext(saved); scratch?.load(saved.ink);
  } catch (error) { if (!isSaveConflict(error)) throw error; await reloadAfterConflict(q, generation, error); }
}); }
</script>
<template>
  <div class="v2-app">
    <header class="v2-mobile"><strong>QuizForge</strong><button @click="drawer = drawer === 'library' ? null : 'library'">题库</button><button @click="drawer = drawer === 'outline' ? null : 'outline'">大纲</button></header>
    <aside class="v2-library" :class="{ open: drawer === 'library' }"><div class="v2-brand"><span>Q</span><div><strong>QuizForge</strong><small>你的练习空间 · V2</small></div></div><h2>我的题库</h2>
      <form v-if="authRequired" @submit.prevent="catalog"><label>连接令牌<input v-model="token" type="password" autocomplete="off"></label><button>连接</button></form>
      <LibraryList :groups="groups" mode="bank" :active-key="overview ? `bank:${overview.bank.bankId}` : null" :can-manage="false" empty-message="暂无 V2 题库" :on-open="openBank" :on-toggle-group="id => { const group = groups.find(g => g.kind === 'group' && g.path === id); if (group?.kind === 'group') group.expanded = !group.expanded; }" :on-notice="text => message = text" :on-manage="() => {}" />
    </aside>
    <main class="v2-main"><header><h1>{{ overview?.bank.title ?? '选择一本题库' }}</h1><span v-if="loading" role="status">{{ loading }}</span><div class="v2-actions"><button v-if="current" :disabled="busy || recovering" @click="toggleDraft">{{ drafting ? '返回作答' : '草稿' }}</button><button v-if="overview" :disabled="busy || recovering" @click="refreshBank">刷新题库</button></div></header>
      <p v-if="message" class="v2-error" role="alert">{{ message }}</p>
      <div v-if="!current" class="v2-empty">从一道题开始<p>选择左侧题库，开始练习。</p></div>
      <div v-show="current" ref="viewport" class="v2-viewport" :inert="busy || recovering"><div ref="stage" class="v2-stage"><div ref="world" class="v2-world">
      <section v-show="current" class="v2-card" :aria-busy="busy || recovering"><div class="v2-question-heading"><span>{{ typeName }}</span><span>{{ current?.state.maxScore }} 分</span></div><div ref="container" class="v2-question-frame" :inert="busy || recovering"></div>
        <div class="v2-answer-footer"><span v-if="saveStatus" class="v2-save-status" role="status">{{ saveStatus }}</span><button v-if="saveStatus === '保存失败'" :disabled="busy" @click="run('正在保存', flush)">重试保存</button>
          <button v-if="current && current.submissionId !== null && current.result === null && !busy" @click="run('正在评分', () => grade(current!))">继续评分</button>
        </div>
      </section>
      </div></div></div>
    </main>
    <aside class="v2-outline" :class="{ open: drawer === 'outline' }"><h2>题目大纲</h2><OutlinePanel :model="outlineModel" :on-navigate="navigate" :on-summary="() => {}" /></aside>
  </div>
</template>
<style>
.v2-app{--accent:#7358d5;display:grid;grid-template-columns:232px minmax(0,1fr) 228px;min-height:100dvh;background:#f8f9fc;color:#343542;font:14px/1.65 'Segoe UI','Microsoft YaHei',sans-serif}.v2-app *{box-sizing:border-box}.v2-app button,.v2-app input{font:inherit}.v2-app :is(header,.v2-answer-footer,.v2-library,.v2-outline) button{cursor:pointer;border:1px solid #e5def6;background:white;color:#655389;border-radius:8px;padding:8px 14px}.v2-app button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}.v2-app button:disabled{opacity:.55;cursor:default}.v2-library,.v2-outline{padding:20px 16px;background:#fcfbff}.v2-library{border-right:1px solid #e6e3ee}.v2-outline{border-left:1px solid #e6e3ee}.v2-brand{display:flex;align-items:center;gap:10px;margin-bottom:28px}.v2-brand>span{background:var(--accent);color:white;border-radius:10px;padding:4px 12px;font-size:22px}.v2-brand strong{font-size:17px}.v2-brand small{display:block;color:#8b869a;font-size:11px}.v2-app h2{font-size:13px;font-weight:500;color:#827b96;margin:16px 0}.v2-main{min-width:0;position:relative;display:flex;flex-direction:column;height:100dvh}.v2-viewport{position:relative;flex:1;min-height:0;overflow:auto;isolation:isolate}.v2-stage{position:relative;min-height:100%}.v2-world{position:relative;z-index:1;display:flow-root;width:100%;transform-origin:0 0}.v2-drafting .v2-world{position:absolute;top:0;left:0;width:760px;transform:translate(var(--qf-whiteboard-x,0px),var(--qf-whiteboard-y,0px)) scale(var(--qf-whiteboard-zoom,1))}.v2-drafting .v2-card{width:calc(100% - 48px);margin:32px auto;padding:24px}.v2-drafting .v2-question-frame iframe{height:420px}.v2-actions{display:flex;gap:8px}.v2-actions button{white-space:nowrap}.v2-empty{position:absolute;inset:64px 0 0;pointer-events:none}.v2-main>header{min-height:64px;padding:14px 24px;background:white;border-bottom:1px solid #e6e3ee;display:flex;gap:15px;align-items:center;justify-content:space-between}.v2-main h1{font-size:16px;margin:0}.v2-main header span{color:#756199}.v2-card{margin:32px auto;padding:24px;background:white;border:1px solid #e5def2;border-radius:16px;max-width:960px;width:calc(100% - 48px)}.v2-question-heading{display:flex;justify-content:space-between;color:#7c61bd;font-size:12px}.v2-question-frame iframe{width:100%;height:420px;border:0;display:block}.v2-answer-footer{display:flex;gap:16px;align-items:center;border-top:1px solid #ece7f6;padding-top:18px;flex-wrap:wrap}.v2-app .v2-answer-footer .primary{background:var(--accent);color:white;border:0}.v2-feedback{white-space:pre-wrap}.v2-error{margin:16px 24px;padding:12px;border:1px solid #eac6c1;border-radius:8px;color:#a13f31;background:#fff7f4}.v2-empty{display:grid;align-content:center;text-align:center;min-height:65vh;color:#827b96;font-size:22px}.v2-empty p{font-size:13px}.v2-mobile{display:none}.v2-app .extension-group-toggle{width:100%;text-align:left;border:0;background:none;display:flex;gap:10px;padding:10px 4px}.v2-app .library-row{display:flex}.v2-app .library-item{display:flex;gap:10px;width:100%;text-align:left;border:0;background:none;margin:4px 0}.v2-app .library-item.active{background:#eee8fc}.v2-app .item-body{display:block}.v2-app .item-meta{display:none}.v2-app .library-row-actions{display:none}.v2-app .outline-group-title{font-size:13px}.v2-app .outline-matrix{display:flex;flex-wrap:wrap;gap:8px}.v2-app .outline-item{min-width:40px;padding:6px}.v2-app .outline-item.active{box-shadow:0 0 0 2px #b7a6e8}.v2-app .outline-item.correct{background:#e5f5ec;color:#286b45}.v2-app .outline-item.wrong{background:#fff0e5;color:#995b2f}.v2-app .outline-item.ungradable{background:#ffedb7;color:#784500;border-color:#d89922}.v2-app .outline-item.answered{background:#eee8fc;color:#655389}.v2-library input{width:100%}body:has(.v2-app){margin:0}@media(max-width:800px){.v2-app{display:block;padding-top:56px}.v2-mobile{display:flex;position:fixed;inset:0 0 auto;height:56px;background:white;z-index:5;align-items:center;padding:8px 16px;gap:12px;border-bottom:1px solid #e6e3ee}.v2-mobile strong{margin-right:auto}.v2-library,.v2-outline{display:none;position:fixed;top:56px;bottom:0;overflow:auto;z-index:4;box-shadow:0 6px 25px #29203922;width:min(86vw,300px)}.v2-library.open,.v2-outline.open{display:block}.v2-outline{right:0}.v2-main{height:calc(100dvh - 56px)}.v2-main>header{padding:14px 16px}.v2-card{width:calc(100% - 24px);margin:16px auto;padding:16px}.v2-question-frame iframe{height:460px}}
.v2-app.v2-fullscreen{grid-template-columns:minmax(0,1fr);padding-top:0}.v2-app.v2-fullscreen>.v2-library,.v2-app.v2-fullscreen>.v2-outline,.v2-app.v2-fullscreen>.v2-mobile,.v2-fullscreen .v2-main>header{display:none}.v2-fullscreen .v2-main{height:100dvh}
</style>
