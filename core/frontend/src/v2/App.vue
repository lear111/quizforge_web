<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import LibraryList from '../library/LibraryList.vue';
import OutlinePanel from '../outline/OutlinePanel.vue';
import type { LibraryTree } from '../library/types';
import type { OutlineModel } from '../outline/model';
import { mountQuestionPage } from './page';
import { createGradingService } from './grading';
const props = defineProps<{ nonce: string }>();
interface State { questionId: string; revision: number; resultRevision: number; status: string; locked: boolean; score: number | null; maxScore: number }
interface Item { id: string; label?: string; maxScore?: number; parts?: { id: string; label: string; maxScore: number }[] }
interface Question { bankId: string; questionId: string; snapshotId: string; question: unknown; solution: unknown; answer: unknown; result: { score: number | null; feedback?: string; reason?: string } | null; submission: unknown; item: Item; extension: { artifactId: string }; state: State }
interface Overview { bank: { bankId: string; title: string }; snapshotId: string; outline: { title: string; items: Item[] }[]; states: State[]; initial: { question: Question | null; error: { message: string } | null }; pendingGrading: { question: Question | null; error: { message: string } | null }[] }
const groups = ref<LibraryTree[]>([]), overview = ref<Overview | null>(null), current = ref<Question | null>(null), container = ref<HTMLElement>();
const busy = ref(false), message = ref(''), loading = ref(''), drawer = ref<'library' | 'outline' | null>(null), token = ref(''), authRequired = ref(false);
let page: ReturnType<typeof mountQuestionPage> | null = null, generation = 0;
async function response(route: string, options: RequestInit = {}) {
  const response = await fetch(route, { ...options, credentials: 'omit', referrerPolicy: 'no-referrer', headers: { ...options.headers, ...(token.value ? { 'x-quizforge-token': token.value } : {}) } });
  if (!response.ok) { const body = await response.json(); if (response.status === 401) authRequired.value = true; throw new Error(body.error?.message || '操作未完成。'); }
  return response;
}
const json = async (route: string, options?: RequestInit) => (await response(route, options)).json();
const text = async (route: string, signal?: AbortSignal) => (await response(route, { signal })).text();
const grader = createGradingService({ loadSource: (id, signal) => text(`/api/v2/extensions/${id}/files/grade-js`, signal), scriptNonce: props.nonce });
const base = (q: Question) => `/api/v2/banks/${q.bankId}/questions/${encodeURIComponent(q.questionId)}`;
const requestId = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), n => n.toString(16).padStart(2, '0')).join('');
const outlineModel = computed<OutlineModel>(() => ({ summaryAvailable: false, summaryShown: false, groups: (overview.value?.outline ?? []).map((group, index) => ({ key: String(index), name: group.title, buttons: group.items.flatMap(item => {
  const state = overview.value?.states.find(s => s.questionId === item.id), status = state?.status === 'graded' ? (state.score === state.maxScore ? 'correct' : 'incorrect') : state?.locked ? 'pending' : 'unanswered';
  return (item.parts ?? [{ id: null, label: item.label ?? item.id }]).map(part => ({ key: `${item.id}:${part.id}`, questionId: item.id, itemId: part.id, label: part.label, status, active: current.value?.questionId === item.id, title: `第 ${part.label} 题`, ariaLabel: `第 ${part.label} 题` }));
}) })) }));
function update(q: Question) { current.value = q; if (overview.value) overview.value.states = overview.value.states.map(s => s.questionId === q.questionId ? q.state : s); }
async function show(q: Question, resume = true) {
  const mine = ++generation; page?.destroy(); page = null; update(q); await nextTick();
  const root = `/api/v2/extensions/${q.extension.artifactId}`;
  const manifest = await json(root + '/manifest');
  const [html, js, css, sdks] = await Promise.all([text(root + '/files/practice-html'), text(root + '/files/practice-js'), text(root + '/files/practice-css'), Promise.all(Object.entries(manifest.sdkVersions ?? {}).filter(([id]) => id === 'richtext').map(([id, version]) => text(`/api/v2/sdk/${id}/${version}/richtext.js`)))]);
  if (mine !== generation || !container.value) return;
  page = mountQuestionPage(container.value, { html, js, css, sdks }, { mode: 'practice', question: q.question, answer: q.answer, solution: q.solution, result: q.result, item: q.item, locked: q.state.locked }, props.nonce);
  await page.ready;
  if (resume && q.state.status === 'submitted-pending') await grade(q);
}
async function run(label: string, action: () => Promise<void>) { if (busy.value) return; busy.value = true; loading.value = label; message.value = ''; try { await action(); } catch (error) { message.value = error instanceof Error ? error.message : '操作未完成。'; } finally { busy.value = false; loading.value = ''; } }
async function catalog() { await run('正在读取题库', async () => {
  const value = await json('/api/v2/catalog'); authRequired.value = false;
  groups.value = value.groups.map((g: { id: string; name: string; items: { bankId: string; title: string; error: { message: string } | null }[] }) => ({ kind: 'group', path: g.id, name: g.name, expanded: false, children: g.items.map(row => ({ kind: 'extension', row: { id: row.bankId, title: row.title, kind: 'bank', error: row.error ?? undefined } })) }));
}); }
async function openBank(_kind: string, id?: string) { if (!id) return; await run('正在打开题库', async () => {
  const value: Overview = await json(`/api/v2/banks/${id}/overview`); overview.value = value; drawer.value = null;
  if (value.initial.question) await show(value.initial.question); else { page?.destroy(); page = null; current.value = null; message.value = value.initial.error?.message ?? '题库没有题目。'; }
  for (const pending of value.pendingGrading) if (pending.question && pending.question.questionId !== current.value?.questionId) {
    const saved = await score(pending.question); overview.value!.states = overview.value!.states.map(s => s.questionId === saved.questionId ? saved.state : s);
  }
}); }
async function navigate(id: string) { const bank = overview.value; if (!bank || id === current.value?.questionId) return; await run('正在打开题目', async () => { await show(await json(`/api/v2/banks/${bank.bank.bankId}/questions/${encodeURIComponent(id)}?snapshotId=${bank.snapshotId}`)); drawer.value = null; }); }
async function score(q: Question): Promise<Question> {
  const [output] = await grader.grade(q.extension.artifactId, [{ questionId: q.questionId, question: q.question, solution: q.solution, answer: q.answer, item: q.item }]);
  return json(base(q) + '/result', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: requestId(), snapshotId: q.snapshotId, submission: q.submission, expectedResultRevision: q.state.resultRevision, source: 'grader', result: output.result }) });
}
async function grade(q: Question) { await show(await score(q)); }
async function submit() { const q = current.value; if (!q || !page || q.state.locked) return; await run('正在提交并评分', async () => {
  const answer = await page!.answer();
  const saved: Question = await json(base(q) + '/submit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: requestId(), snapshotId: q.snapshotId, expectedRevision: q.state.revision, answer }) });
  await show(saved, false); await grade(saved);
}); }
onMounted(catalog); onBeforeUnmount(() => { generation++; page?.destroy(); grader.dispose(); });
</script>
<template>
  <div class="v2-app">
    <header class="v2-mobile"><strong>QuizForge</strong><button @click="drawer = drawer === 'library' ? null : 'library'">题库</button><button @click="drawer = drawer === 'outline' ? null : 'outline'">大纲</button></header>
    <aside class="v2-library" :class="{ open: drawer === 'library' }"><div class="v2-brand"><span>Q</span><div><strong>QuizForge</strong><small>你的练习空间 · V2</small></div></div><h2>我的题库</h2>
      <form v-if="authRequired" @submit.prevent="catalog"><label>连接令牌<input v-model="token" type="password" autocomplete="off"></label><button>连接</button></form>
      <LibraryList :groups="groups" mode="bank" :active-key="overview ? `bank:${overview.bank.bankId}` : null" :can-manage="false" empty-message="暂无 V2 题库" :on-open="openBank" :on-toggle-group="id => { const group = groups.find(g => g.kind === 'group' && g.path === id); if (group?.kind === 'group') group.expanded = !group.expanded; }" :on-notice="text => message = text" :on-manage="() => {}" />
    </aside>
    <main class="v2-main"><header><h1>{{ overview?.bank.title ?? '选择一本题库' }}</h1><span v-if="loading" role="status">{{ loading }}</span></header>
      <p v-if="message" class="v2-error" role="alert">{{ message }}</p>
      <div v-if="!current" class="v2-empty">从一道题开始<p>选择左侧题库，开始练习。</p></div>
      <section v-show="current" class="v2-card" :aria-busy="busy"><div class="v2-question-heading"><span>单选题</span><span>{{ current?.state.maxScore }} 分</span></div><div ref="container" class="v2-question-frame"></div>
        <div class="v2-answer-footer"><button class="primary" :disabled="busy || current?.state.locked" @click="submit">{{ current?.state.locked ? '已提交' : '提交答案' }}</button>
          <strong v-if="current?.result" role="status">{{ current.result.score === null ? (current.result.reason ?? '待评分') : `${current.result.score} / ${current.state.maxScore} 分` }}</strong>
          <span v-else-if="current?.state.locked">答案已锁定，等待评分</span>
          <button v-if="current?.state.status === 'submitted-pending' && !busy" @click="run('正在评分', () => grade(current!))">继续评分</button>
        </div><p v-if="current?.result?.feedback" class="v2-feedback">{{ current.result.feedback }}</p>
      </section>
    </main>
    <aside class="v2-outline" :class="{ open: drawer === 'outline' }"><h2>题目大纲</h2><OutlinePanel :model="outlineModel" :on-navigate="navigate" :on-summary="() => {}" /></aside>
  </div>
</template>
<style>
.v2-app{--accent:#7358d5;display:grid;grid-template-columns:232px minmax(0,1fr) 228px;min-height:100dvh;background:#f8f9fc;color:#343542;font:14px/1.65 'Segoe UI','Microsoft YaHei',sans-serif}.v2-app *{box-sizing:border-box}.v2-app button,.v2-app input{font:inherit}.v2-app button{cursor:pointer;border:1px solid #e5def6;background:white;color:#655389;border-radius:8px;padding:8px 14px}.v2-app button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}.v2-app button:disabled{opacity:.55;cursor:default}.v2-library,.v2-outline{padding:20px 16px;background:#fcfbff}.v2-library{border-right:1px solid #e6e3ee}.v2-outline{border-left:1px solid #e6e3ee}.v2-brand{display:flex;align-items:center;gap:10px;margin-bottom:28px}.v2-brand>span{background:var(--accent);color:white;border-radius:10px;padding:4px 12px;font-size:22px}.v2-brand strong{font-size:17px}.v2-brand small{display:block;color:#8b869a;font-size:11px}.v2-app h2{font-size:13px;font-weight:500;color:#827b96;margin:16px 0}.v2-main{min-width:0}.v2-main>header{min-height:64px;padding:14px 24px;background:white;border-bottom:1px solid #e6e3ee;display:flex;gap:15px;align-items:center;justify-content:space-between}.v2-main h1{font-size:16px;margin:0}.v2-main header span{color:#756199}.v2-card{margin:32px auto;padding:24px;background:white;border:1px solid #e5def2;border-radius:16px;max-width:960px;width:calc(100% - 48px)}.v2-question-heading{display:flex;justify-content:space-between;color:#7c61bd;font-size:12px}.v2-question-frame iframe{width:100%;height:420px;border:0;display:block}.v2-answer-footer{display:flex;gap:16px;align-items:center;border-top:1px solid #ece7f6;padding-top:18px;flex-wrap:wrap}.v2-app .primary{background:var(--accent);color:white;border:0}.v2-feedback{white-space:pre-wrap}.v2-error{margin:16px 24px;padding:12px;border:1px solid #eac6c1;border-radius:8px;color:#a13f31;background:#fff7f4}.v2-empty{display:grid;align-content:center;text-align:center;min-height:65vh;color:#827b96;font-size:22px}.v2-empty p{font-size:13px}.v2-mobile{display:none}.v2-app .extension-group-toggle{width:100%;text-align:left;border:0;background:none;display:flex;gap:10px;padding:10px 4px}.v2-app .library-row{display:flex}.v2-app .library-item{display:flex;gap:10px;width:100%;text-align:left;border:0;background:none;margin:4px 0}.v2-app .library-item.active{background:#eee8fc}.v2-app .item-body{display:block}.v2-app .item-meta{display:none}.v2-app .library-row-actions{display:none}.v2-app .outline-group-title{font-size:13px}.v2-app .outline-matrix{display:flex;flex-wrap:wrap;gap:8px}.v2-app .outline-item{min-width:40px;padding:6px}.v2-app .outline-item.active{box-shadow:0 0 0 2px #b7a6e8}.v2-app .outline-item.correct{background:#e5f5ec;color:#286b45}.v2-app .outline-item.incorrect{background:#fff0e5;color:#995b2f}.v2-app .outline-item.pending{background:#fff7d8}.v2-app input{width:100%}body:has(.v2-app){margin:0}@media(max-width:800px){.v2-app{display:block;padding-top:56px}.v2-mobile{display:flex;position:fixed;inset:0 0 auto;height:56px;background:white;z-index:5;align-items:center;padding:8px 16px;gap:12px;border-bottom:1px solid #e6e3ee}.v2-mobile strong{margin-right:auto}.v2-library,.v2-outline{display:none;position:fixed;top:56px;bottom:0;overflow:auto;z-index:4;box-shadow:0 6px 25px #29203922;width:min(86vw,300px)}.v2-library.open,.v2-outline.open{display:block}.v2-outline{right:0}.v2-main>header{padding:14px 16px}.v2-card{width:calc(100% - 24px);margin:16px auto;padding:16px}.v2-question-frame iframe{height:460px}}
</style>
