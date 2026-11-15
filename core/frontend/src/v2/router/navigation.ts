import type {
  Router,
  RouteLocationNormalized,
  RouteLocationRaw,
  NavigationGuardReturn,
} from 'vue-router';
import type { usePracticeStore } from '../stores/practice';
import type { useUiStore } from '../stores/ui';

type Practice = ReturnType<typeof usePracticeStore>;
type Ui = ReturnType<typeof useUiStore>;

export function visibleLocation(practice: Practice, ui: Ui): RouteLocationRaw {
  const bankId = practice.overview?.bank.bankId;
  if (!bankId) {
    return { name: 'library' };
  }
  if (ui.scoreView) {
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
  } else if (to.name === 'summary') {
    ui.scoreView = true;
  }
}

class WorkspaceNavigation {
  private started = false;
  private pending: Promise<NavigationGuardReturn> | null = null;
  private pushing = false;
  private disposed = false;
  private stop: () => void;

  constructor(
    private router: Router,
    private practice: Practice,
    private ui: Ui,
  ) {
    this.stop = router.beforeEach(this.load);
  }

  private report = (error: unknown) => {
    this.ui.message = error instanceof Error ? error.message : '页面未能打开。';
  };
  private async flush() {
    // Make the old pane inert throughout the asynchronous flush, just as the
    // store's existing navigation does. The guard owns this first save barrier.
    this.ui.busy = true;
    this.ui.loading = '正在打开页面';
    try {
      await this.practice.flush();
    } finally {
      this.ui.busy = false;
      this.ui.loading = '';
    }
  }
  private load = async (to: RouteLocationNormalized): Promise<NavigationGuardReturn> => {
    if (!this.started) {
      return true;
    }
    if (this.disposed) {
      return false;
    }
    if (this.pending) {
      // A direct hash change can supersede an awaited guard after its store
      // action has already started. Join that action, then keep its visible
      // location; do not let Router cancellation strand the URL on the old page.
      await this.pending;
      if (this.disposed) {
        return false;
      }
      const target = this.router.resolve(visibleLocation(this.practice, this.ui));
      return target.fullPath === to.fullPath ? true : { ...target, replace: true };
    }
    if (this.ui.busy || this.practice.recovering) {
      return false;
    }
    this.pending = this.loadTarget(to);
    try {
      return await this.pending;
    } finally {
      this.pending = null;
    }
  };
  private async loadTarget(to: RouteLocationNormalized): Promise<NavigationGuardReturn> {
    const { router, practice, ui } = this;
    // Canonical redirects and store-driven view changes already display the
    // target. Loading again would dismiss a drawer opened during iframe load.
    if (
      !practice.pageFaulted() &&
      router.resolve(visibleLocation(practice, ui)).fullPath === to.fullPath
    ) {
      return true;
    }
    try {
      await this.flush();
      await loadLocation(to, practice, ui);
      const target = visibleLocation(practice, ui);
      if (router.resolve(target).fullPath === to.fullPath) {
        return true;
      }
      // Bank-only URLs get their question/summary from the existing store.
      // Unavailable initial links fall back to the blank library page. A failed
      // navigation from an existing page is cancelled without changing its URL.
      if (
        (to.name === 'bank' || to.name === 'summary') &&
        practice.overview?.bank.bankId === String(to.params.bankId)
      ) {
        return { ...router.resolve(target), replace: true };
      }
      if (router.currentRoute.value.name === undefined || !practice.overview) {
        return { name: 'library', replace: true };
      }
      return false;
    } catch (error) {
      this.report(error);
      return false;
    }
  }
  private async push(target: RouteLocationRaw, replace = false) {
    const { practice, ui, router } = this;
    if (this.pending || this.pushing || ui.busy || practice.recovering || this.disposed) {
      return;
    }
    this.pushing = true;
    try {
      const force =
        practice.pageFaulted() &&
        router.resolve(target).fullPath === router.currentRoute.value.fullPath;
      await router.push({ ...router.resolve(target), force, replace });
    } catch (error) {
      this.report(error);
    } finally {
      this.pushing = false;
    }
  }
  private async restore() {
    if (!this.ui.authRequired) {
      // The initial address was accepted before the view's DOM containers were
      // mounted. Re-enter it through the same guard after catalog login.
      await this.router.replace({ ...this.router.currentRoute.value, force: true });
    }
  }
  start = async () => {
    if (this.started || this.disposed) {
      return;
    }
    await this.practice.initializeCatalog();
    this.started = true;
    await this.restore();
  };
  catalog = async () => {
    await this.practice.catalog();
    await this.restore();
  };
  openBank = (_kind: string, bankId?: string) =>
    bankId ? this.push({ name: 'bank', params: { bankId } }) : Promise.resolve();
  navigate = (questionId: string) => {
    const bankId = this.practice.overview?.bank.bankId;
    return bankId
      ? this.push({ name: 'practice', params: { bankId, questionId } })
      : Promise.resolve();
  };
  showSummary = () => {
    const bankId = this.practice.overview?.bank.bankId;
    return bankId ? this.push({ name: 'summary', params: { bankId } }) : Promise.resolve();
  };
  showQuestion = () => {
    const bankId = this.practice.overview?.bank.bankId;
    return bankId
      ? this.push({
          name: 'practice',
          params: { bankId, questionId: this.practice.current?.questionId },
        })
      : Promise.resolve();
  };
  // Views call this after completion/refresh; there is no reverse state watcher.
  showCurrent = () => this.push(visibleLocation(this.practice, this.ui), true);
  dispose = () => {
    this.disposed = true;
    this.stop();
  };
}

export function createWorkspaceNavigation(router: Router, practice: Practice, ui: Ui) {
  return new WorkspaceNavigation(router, practice, ui);
}
