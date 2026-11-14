import { nextTick, onBeforeUnmount, onMounted, ref, toRaw } from 'vue';
import { answeredFromStatus, reportOutlineStatus } from '../../../shared/v2/answered.js';
import { mountQuestionPage } from './page';
import { createGradingService } from './grading';
import { saveGrade, recoverGrades } from './scoring';
import { createSaveController, attachSaveLifecycle, isSaveConflict, saveRecoveryMessage } from './save-policy';
import { createPageSourceCache } from './source-cache';
import { createWriteQueue } from './write-queue';
import { mountScratch } from './whiteboard';
import type { Picture } from './page';
import type { Overview, PracticeWorkspace, Question } from './practice-types';

export function usePracticePage(workspace: PracticeWorkspace, requestPrefix: (bankId: string) => string, nonce: string) {
  const { overview, busy, message, token, response, json, run, remember } = workspace;
  const current = ref<Question | null>(null), container = ref<HTMLElement>();
  const typeName = ref('题目'), saveStatus = ref('');
  const recovering = ref(false), drafting = ref(false), viewport = ref<HTMLElement>(), stage = ref<HTMLElement>(), world = ref<HTMLElement>();
  let scratch: ReturnType<typeof mountScratch> | null = null;
  let answerVersion = 0, inkVersion = 0, savedAnswer = 0, savedInk = 0;
  const queue = createWriteQueue();
  const enqueue = queue.enqueue;
  let page: ReturnType<typeof mountQuestionPage> | null = null, generation = 0;
  let saver: ReturnType<typeof createSaveController<Record<string, unknown>>> | null = null;
  const text = async (route: string, signal?: AbortSignal) => (await response(route, { signal })).text();
  const sources = createPageSourceCache({ json: (route, signal) => json(route, { signal }), text });
  const grader = createGradingService({ loadSource: (id, signal) => text(`/api/v2/extensions/${id}/files/grade-js`, signal), scriptNonce: nonce });
  const base = (q: Question) => `${requestPrefix(q.bankId)}/questions/${encodeURIComponent(q.questionId)}`;
  const requestId = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), n => n.toString(16).padStart(2, '0')).join('');
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
        try { value = await json(`${requestPrefix(previous.bankId)}/overview`); }
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
    const instance = mountQuestionPage(container.value, loaded, context(q), nonce, {
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
  });
  onBeforeUnmount(() => { detach(); disposePage(); scratch?.destroy(); sources.dispose(); grader.dispose(); });
  async function toggleDraft() { scratch?.flush(); drafting.value = !drafting.value; scratch?.setMode(drafting.value); }
  async function retry() { if (!current.value) return; await run('正在重做', async () => {
    await flush(); const q = current.value!;
    try {
      const saved = await enqueue(() => json(base(q) + '/retry', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: requestId(), snapshotId: q.snapshotId, expectedRevision: q.state.revision }) }));
      await applyContext(saved); scratch?.load(saved.ink);
    } catch (error) { if (!isSaveConflict(error)) throw error; await reloadAfterConflict(q, generation, error); }
  }); }

  function scopeSources(bankId: string, snapshotId: string) { sources.scope(bankId, snapshotId, token.value); }
  function resetSources() { sources.dispose(); }
  function clearQuestion(clearInk = false) { disposePage(); current.value = null; if (clearInk) scratch?.load(null); }
  async function recoverPending(value: Overview) {
    await recoverGrades(value.pendingGrading.flatMap(pending => pending.question ? [pending.question] : []), score, async saved => {
      overview.value!.states = overview.value!.states.map(s => s.questionId === saved.questionId ? saved.state : s);
      if (saved.questionId === current.value?.questionId) { await flush(); if (current.value) await applyContext(current.value); }
    }, error => { message.value = error instanceof Error ? error.message : '部分题目暂未完成评分，请稍后重试。'; });
  }
  function continueGrading() { if (current.value) return run('正在评分', () => grade(current.value!)); }
  function retrySave() { return run('正在保存', flush); }
  return { current, container, typeName, saveStatus, recovering, drafting, viewport, stage, world,
    flush, show, clearQuestion, resetSources, scopeSources, recoverPending, continueGrading, retrySave, toggleDraft,
    pageFaulted: () => page?.faulted };
}
