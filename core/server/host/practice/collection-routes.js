import { ApiError, bad, routeId } from '../platform/errors.js';
import { fingerprint } from '../platform/json.js';
import { readMaterial } from '../resources/listening.js';
import { targetId } from '../ai/ai-protocol.js';

export class CollectionRoutes {
  constructor(library, states, ai, writes, automaticAi) { Object.assign(this, { library, states, ai, writes, automaticAi }); }
  async route(context, method, parts, resolvedCollection = null) {
    const { library, states, ai, writes } = this; states.recover(); const kind = parts[2], id = routeId(parts[3]);
    if (!['bank', 'extension', 'development', 'development-bank', 'exam'].includes(kind)) throw bad('Invalid collection kind');
    // Reuse the binding already checked by the HTTP router for this read.
    // Writes still resolve again after reading their request body.
    const readCollection = () => resolvedCollection ?? library.readCollection(kind, id);
    if (parts[4] === 'history') try { (await library.collection(kind, id)).features.requireHistory(); } catch (error) { if (error.code !== 'COLLECTION_NOT_FOUND') throw error; }
    if (parts.length === 4 && method === 'GET') return states.overview(await readCollection());
    if (parts.length === 6 && parts[4] === 'listening' && method === 'GET') return readMaterial(await readCollection(), routeId(parts[5]));
    if (parts.length === 5) {
      if (parts[4] === 'summary' && method === 'GET') return states.summary(await library.collection(kind, id));
      if (parts[4] === 'history' && method === 'GET') return states.history(kind, id);
      if (parts[4] === 'restart' && method === 'POST') { const request = await writes.read(context); return states.restart(await library.collection(kind, id), request); }
      if (parts[4] === 'finish' && method === 'POST') {
        const request = await writes.read(context), collection = await library.collection(kind, id);
        const completed = await states.completionResult(collection, request);
        if (completed?.finished) return completed;
        const summary = await states.submitSaved(collection, request);
        if (summary.finished) return states.finish(collection, { ...request, roundId: summary.roundId, summaryVersion: summary.summaryVersion });
        let running = false, gradingError = false;
        const newlySubmitted = (await states.completionResult(collection, request))?.submittedQuestions ?? [];
        const summaryRows = new Map(summary.questions.map(row => [row.id, row]));
        for (const question of collection.questions) {
          const row = summaryRows.get(question.id);
          if (this.automaticAi() && row?.submitted && (newlySubmitted.includes(question.id) || row.gradingStatus === 'pending')) {
            const response = await states.question(collection, question);
            if (response.capabilities.canAiGrade) try { await ai.startAutomatic(collection, question, { requestId: 'auto-complete-' + fingerprint({ requestId: request.requestId, qid: question.id }, 'quizforge-auto-complete-v1'), contentVersion: response.stamp.contentVersion }); } catch { /* Keep pending answers available for manual review. */ }
          }
          for (const taskId of await states.currentAiTaskIds(collection, question)) {
            const task = await ai.get(collection, question, taskId);
            if (['queued', 'running', 'succeeded'].includes(task.status)) running = true;
            if (task.status === 'failed') gradingError = true;
          }
        }
        const latest = await states.summary(collection);
        if (running || gradingError || latest.pendingCount > 0) return { ...latest, completionPending: true, ...(gradingError ? { completionError: 'AI 评分失败，请返回题目重试或人工评分，再完成练习。' } : {}) };
        return states.saveCompletionResult(collection, request, await states.finish(collection, { ...request, roundId: latest.roundId, summaryVersion: latest.summaryVersion }));
      }
    }
    if (parts.length === 6 && parts[4] === 'history') { if (method === 'GET') return states.history(kind, id, routeId(parts[5])); if (method === 'DELETE') { writes.validateOrigin(context); return states.deleteHistory(kind, id, routeId(parts[5])); } }
    if (parts.length >= 6 && parts[4] === 'questions') {
      const qid = routeId(parts[5]);
      if (parts.length === 6 && method === 'GET') {
        const collection = await readCollection(), question = collection.question(qid);
        const known = context.request.headers['x-quizforge-question-stamp'];
        if (known !== undefined) {
          let expected;
          try { if (typeof known !== 'string' || known.length > 1024) throw new Error(); expected = JSON.parse(known); } catch { throw bad('Invalid question stamp'); }
          if (!expected || typeof expected !== 'object' || !Number.isSafeInteger(expected.revision) || expected.revision < 0 || typeof expected.contentVersion !== 'string' || typeof expected.packageVersion !== 'string') throw bad('Invalid question stamp');
          const stamp = await states.stamp(collection, question);
          if (stamp.revision === expected.revision && stamp.contentVersion === expected.contentVersion && stamp.packageVersion === expected.packageVersion) return { unchanged: true, stamp };
        }
        const response = await states.question(collection, question), task = await ai.current(collection, question); if (task !== null) response.aiTask = task; return response;
      }
      if (parts.length === 7) {
        if (parts[6] === 'stamp' && method === 'GET') { const collection = await readCollection(); return states.stamp(collection, collection.question(qid)); }
        if (parts[6] === 'editor' && method === 'GET') { const collection = await library.collection(kind, id); return states.editor(library, collection, collection.question(qid)); }
        if (parts[6] === 'edit' && method === 'POST') { const request = await writes.read(context), collection = await library.collection(kind, id); return states.edit(library, collection, collection.question(qid), request); }
        if (parts[6] === 'actions' && method === 'POST') {
          const request = await writes.read(context), collection = await library.writeCollection(kind, id), question = collection.question(qid), submit = request.action === 'submit', revision = submit ? (await states.stamp(collection, question)).revision : -1, response = await states.act(collection, question, request);
          if (submit && request.revision === revision && response.state.revision === revision + 1 && response.capabilities.canAiGrade && this.automaticAi()) try { await ai.startAutomatic(collection, question, { requestId: 'auto-submit-' + fingerprint(request, 'quizforge-auto-submit-v1'), contentVersion: response.stamp.contentVersion }); } catch { /* Submission remains durable if scheduling fails. */ }
          return response;
        }
      }
      if (parts.length >= 8 && parts[6] === 'ai') {
        const collection = await library.collection(kind, id), question = collection.question(qid);
        if (parts.length === 8 && parts[7] === 'current' && method === 'GET') { const parameters = context.url.searchParams.getAll('targetId'); if (parameters.length > 1) throw bad('Invalid AI targetId query'); return { task: await ai.current(collection, question, parameters.length ? targetId({ targetId: parameters[0] }) : null) }; }
        if (parts.length === 8 && parts[7] === 'grade' && method === 'POST') return ai.start(collection, question, await writes.read(context));
        if (parts.length >= 9 && parts[7] === 'tasks') {
          const task = routeId(parts[8]); if (parts.length === 9 && method === 'GET') return ai.get(collection, question, task);
          if (parts.length === 10 && method === 'POST') { if (parts[9] === 'retry') return ai.retry(collection, question, task, await writes.read(context)); if (parts[9] === 'confirm') return ai.confirm(collection, question, task, await writes.read(context)); }
        }
      }
    }
    throw new ApiError(404, 'NOT_FOUND', 'Endpoint not found');
  }
}
