import { createWriteQueue } from '../services/write-queue';
import { createPageSourceCache } from '../services/source-cache';
import { createGradingService } from '../services/grading';
import { createCompletionGrader } from '../services/completion';
import { attachSaveLifecycle } from '../services/save-policy';
import { mountScratch } from '../services/whiteboard';
import type { PracticeSession, PracticeRuntime, ViewElements } from '../types/practice-session';

// Handles are private to this store instance, not reactive/serializable UI state.
export function createRuntime(): PracticeRuntime {
  return {
    page: null,
    scratch: null,
    saver: null,
    sources: null,
    grader: null,
    completionGrader: null,
    queue: createWriteQueue(),
    generation: 0,
    answerVersion: 0,
    inkVersion: 0,
    savedAnswer: 0,
    savedInk: 0,
    nonce: '',
    container: undefined,
    detach: null,
  };
}
export function initializeRuntime(ctx: PracticeSession, nonce: string) {
  const runtime = ctx.runtime;
  runtime.nonce = nonce;
  runtime.sources = createPageSourceCache(ctx.api);
  runtime.grader = createGradingService({
    loadSource: (id, signal) => ctx.api.extensions.file(id, 'grade-js', signal),
    scriptNonce: nonce,
  });
  runtime.completionGrader = createCompletionGrader({
    grade: (id, items) => runtime.grader!.grade(id, items),
    send: (body) =>
      runtime.queue.enqueue(() => ctx.api.banks.results(ctx.overview.value!.bank.bankId, body)),
  });
}
export function attachView(ctx: PracticeSession, nonce: string, elements: ViewElements) {
  ctx.actions().initializeRuntime(nonce);
  const { runtime } = ctx;
  runtime.container = elements.container;
  runtime.detach = attachSaveLifecycle(window, {
    get dirty() {
      return runtime.saver?.dirty ?? false;
    },
    flush: ctx.actions().flush,
  });
  runtime.scratch = mountScratch(elements.viewport, elements.stage, elements.world, {
    changed() {
      if (ctx.current.value) {
        runtime.inkVersion++;
        runtime.saver?.changed('ink');
      }
    },
    error(error) {
      ctx.message.value = error.message;
    },
  });
}
export function detachView(ctx: PracticeSession) {
  const { runtime } = ctx;
  runtime.detach?.();
  ctx.actions().disposePage();
  runtime.scratch?.destroy();
  runtime.sources?.dispose();
  runtime.grader?.dispose();
  runtime.completionGrader?.clear();
  runtime.container = undefined;
}
export async function toggleDraft(ctx: PracticeSession) {
  ctx.runtime.scratch?.flush();
  ctx.drafting.value = !ctx.drafting.value;
  ctx.runtime.scratch?.setMode(ctx.drafting.value);
}
