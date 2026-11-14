import * as state from './question-state';
import * as page from './page';
import * as saving from './saving';
import * as recovery from './recovery';
import * as scoring from './scoring';
import * as completion from './completion';
import * as banks from './banks';
import * as runtime from './runtime';
import type { PracticeSession, PracticeActions } from '../../types/practice-session';

// All callbacks close over this one session; no mutable singleton or component
// reference is needed to coordinate saving, navigation and scoring.
export function createActions(ctx: PracticeSession): PracticeActions {
  return {
    update: (q, preserve) => state.update(ctx, q, preserve),
    context: (q) => state.context(ctx, q),
    applyCompletion: (value) => state.applyCompletion(ctx, value),
    pictures: (q, has) => page.pictures(ctx, q, has),
    disposePage: () => page.disposePage(ctx),
    applyContext: (q) => page.applyContext(ctx, q),
    show: (q, resume) => page.show(ctx, q, resume),
    scopeSources: (bank, snapshot) => page.scopeSources(ctx, bank, snapshot),
    resetSources: () => page.resetSources(ctx),
    clearQuestion: (ink) => page.clearQuestion(ctx, ink),
    createSaver: (q, mine, instance) => saving.createSaver(ctx, q, mine, instance),
    flush: () => saving.flush(ctx),
    retrySave: () => saving.retrySave(ctx),
    reloadAfterConflict: (q, mine, error) => recovery.reloadAfterConflict(ctx, q, mine, error),
    score: (q) => scoring.score(ctx, q),
    grade: (q) => scoring.grade(ctx, q),
    submit: () => scoring.submit(ctx),
    retry: () => scoring.retry(ctx),
    recoverPending: (value) => scoring.recoverPending(ctx, value),
    continueGrading: () => scoring.continueGrading(ctx),
    reloadCompletedQuestion: () => completion.reloadCompletedQuestion(ctx),
    gradeCompleted: (value) => completion.gradeCompleted(ctx, value),
    complete: () => completion.complete(ctx),
    resumeCompletion: () => completion.resumeCompletion(ctx),
    initializeRuntime: (nonce) => runtime.initializeRuntime(ctx, nonce),
    attachView: (nonce, elements) => runtime.attachView(ctx, nonce, elements),
    detachView: () => runtime.detachView(ctx),
    toggleDraft: () => runtime.toggleDraft(ctx),
    pageFaulted: () => ctx.runtime.page?.faulted,
    remember: (q) => banks.remember(ctx, q),
    catalog: () => banks.catalog(ctx),
    openBank: (kind, id, questionId) => banks.openBank(ctx, kind, id, questionId),
    navigate: (id) => banks.navigate(ctx, id),
    refreshBank: () => banks.refreshBank(ctx),
    initializeCatalog: () => banks.initializeCatalog(ctx),
  };
}
