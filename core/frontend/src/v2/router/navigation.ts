import { watch } from 'vue';
import type { Router, RouteLocationNormalized, RouteLocationRaw } from 'vue-router';
import type { usePracticeStore } from '../stores/practice';
import type { useUiStore } from '../stores/ui';

type Practice = ReturnType<typeof usePracticeStore>;
type Ui = ReturnType<typeof useUiStore>;

export function visibleLocation(practice: Practice, ui: Ui): RouteLocationRaw {
  const bankId = practice.overview?.bank.bankId;
  if (!bankId) {
    return { name: 'library' };
  }
  if (ui.scoreView && practice.overview?.completedAt) {
    return { name: 'summary', params: { bankId } };
  }
  const questionId = practice.current?.bankId === bankId ? practice.current.questionId : undefined;
  return { name: 'practice', params: { bankId, questionId } };
}

async function loadLocation(to: RouteLocationNormalized, practice: Practice, ui: Ui) {
  if (to.name === 'library') {
    practice.clearQuestion(true);
    practice.resetSources();
    practice.overview = null;
    ui.scoreView = false;
    ui.drawer = null;
    return;
  }
  const bankId = String(to.params.bankId);
  const questionId = to.params.questionId ? String(to.params.questionId) : undefined;
  // Close the drawer at navigation start. A user can reopen it while an
  // iframe loads; finishing that load must not dismiss the newly opened menu.
  ui.drawer = null;
  if (to.name === 'bank' || practice.overview?.bank.bankId !== bankId) {
    await practice.openBank('bank', bankId, questionId);
  } else if (to.name === 'practice' && questionId) {
    await practice.navigate(questionId);
  }
  if (practice.overview?.bank.bankId !== bankId) {
    return;
  }
  if (to.name === 'practice' && (!questionId || practice.current?.questionId === questionId)) {
    ui.scoreView = false;
  } else if (to.name === 'summary' && practice.overview.completedAt) {
    ui.scoreView = true;
  }
}

class WorkspaceNavigation {
  private started = false;
  private loading = false;
  private pushing = false;
  private disposed = false;
  private cleanup: (() => void)[];

  constructor(
    private router: Router,
    private practice: Practice,
    private ui: Ui,
  ) {
    this.cleanup = [
      router.beforeEach(this.canLeave),
      watch(
        router.currentRoute,
        (to) => {
          if (this.started) {
            void this.load(to);
          }
        },
        { flush: 'sync' },
      ),
      watch(
        () => [
          practice.overview?.bank.bankId,
          practice.current?.questionId,
          ui.scoreView,
          ui.busy,
          practice.recovering,
        ],
        this.synchronize,
      ),
    ];
  }

  private report = (error: unknown) => {
    this.ui.message = error instanceof Error ? error.message : '页面未能打开。';
  };
  private synchronize = () => {
    const { practice, ui, router } = this;
    if (
      !this.started ||
      this.disposed ||
      this.loading ||
      ui.busy ||
      ui.authRequired ||
      practice.recovering
    ) {
      return;
    }
    const target = visibleLocation(practice, ui);
    if (router.resolve(target).fullPath !== router.currentRoute.value.fullPath) {
      // Failed loads keep the old page and restore its address; successful
      // loads canonicalize bank-only URLs without adding a history entry.
      void router.replace(target).catch(this.report);
    }
  };
  private async load(to: RouteLocationNormalized) {
    if (this.disposed || this.ui.authRequired) {
      return;
    }
    // Canonical replacements and failed-load rollbacks already display this
    // state. Reapplying it could dismiss a menu opened during the first load.
    if (
      !this.practice.pageFaulted() &&
      this.router.resolve(visibleLocation(this.practice, this.ui)).fullPath === to.fullPath
    ) {
      return;
    }
    this.loading = true;
    try {
      await loadLocation(to, this.practice, this.ui);
    } catch (error) {
      this.report(error);
    } finally {
      this.loading = false;
      this.synchronize();
    }
  }
  private canLeave = async () => {
    if (this.loading || this.ui.busy || this.practice.recovering) {
      return false;
    }
    try {
      // This also covers browser back/forward and direct hash changes. On
      // failure Vue Router restores the old address and keeps the old iframe.
      await this.practice.flush();
      return true;
    } catch (error) {
      this.report(error);
      return false;
    }
  };
  private async push(target: RouteLocationRaw) {
    const { practice, ui, router } = this;
    if (this.loading || this.pushing || ui.busy || practice.recovering || this.disposed) {
      return;
    }
    this.pushing = true;
    try {
      // Clicking the current outline item also reloads a faulted page, as the
      // existing practice action does; duplicate healthy routes remain no-ops.
      const force =
        practice.pageFaulted() &&
        router.resolve(target).fullPath === router.currentRoute.value.fullPath;
      await router.push({ ...router.resolve(target), force });
    } catch (error) {
      this.report(error);
    } finally {
      this.pushing = false;
    }
  }
  start = async () => {
    if (this.started || this.disposed) {
      return;
    }
    await this.practice.initializeCatalog();
    this.started = true;
    await this.load(this.router.currentRoute.value);
  };
  catalog = async () => {
    await this.practice.catalog();
    await this.load(this.router.currentRoute.value);
  };
  openBank = (_kind: string, bankId?: string) => {
    return bankId ? this.push({ name: 'bank', params: { bankId } }) : Promise.resolve();
  };
  navigate = (questionId: string) => {
    const bankId = this.practice.overview?.bank.bankId;
    return bankId
      ? this.push({ name: 'practice', params: { bankId, questionId } })
      : Promise.resolve();
  };
  showSummary = () => {
    const bankId = this.practice.overview?.bank.bankId;
    return bankId && this.practice.overview?.completedAt
      ? this.push({ name: 'summary', params: { bankId } })
      : Promise.resolve();
  };
  showQuestion = () => {
    const bankId = this.practice.overview?.bank.bankId;
    return bankId
      ? this.push({
          name: 'practice',
          params: {
            bankId,
            questionId: this.practice.current?.questionId,
          },
        })
      : Promise.resolve();
  };
  dispose = () => {
    this.disposed = true;
    this.cleanup.forEach((stop) => stop());
  };
}

export function createWorkspaceNavigation(router: Router, practice: Practice, ui: Ui) {
  return new WorkspaceNavigation(router, practice, ui);
}
