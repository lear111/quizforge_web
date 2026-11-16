import type { Ref } from 'vue';
import type { PracticeWorkspace, Question, Overview, Completion } from './practice-types';
import type { PageContext, Picture, mountQuestionPage } from '../services/page';
import type { createSaveController } from '../services/save-policy';
import type { createWriteQueue } from '../services/write-queue';
import type { createPageSourceCache } from '../services/source-cache';
import type { createGradingService } from '../services/grading';
import type { createCompletionGrader } from '../services/completion';
import type { mountScratch } from '../services/whiteboard';
import type { PracticeApi } from '../api';

export type QuestionPage = ReturnType<typeof mountQuestionPage>;
export type Saver = ReturnType<typeof createSaveController>;
export interface ViewElements {
  container: HTMLElement;
  viewport: HTMLElement;
  stage: HTMLElement;
  world: HTMLElement;
}
export interface PracticeRuntime {
  restartRequest: { bankId: string; snapshotId: string; body: string } | null;
  page: QuestionPage | null;
  scratch: ReturnType<typeof mountScratch> | null;
  saver: Saver | null;
  sources: ReturnType<typeof createPageSourceCache> | null;
  grader: ReturnType<typeof createGradingService> | null;
  completionGrader: ReturnType<typeof createCompletionGrader> | null;
  queue: ReturnType<typeof createWriteQueue>;
  generation: number;
  answerVersion: number;
  inkVersion: number;
  savedAnswer: number;
  savedInk: number;
  nonce: string;
  container: HTMLElement | undefined;
  detach: (() => void) | null;
}
// The Pinia surface used by views and Router; runtime helpers stay in the session.
export interface PracticeViewActions {
  flush(): Promise<void>;
  retrySave(): Promise<void>;
  continueGrading(): Promise<void> | undefined;
  complete(): Promise<void>;
  resumeCompletion(): Promise<void>;
  restart(): Promise<void>;
  resetSources(): void;
  clearQuestion(clearInk?: boolean): void;
  attachView(nonce: string, elements: ViewElements): void;
  detachView(): void;
  toggleDraft(): Promise<void>;
  pageFaulted(): boolean | undefined;
  catalog(): Promise<void>;
  openBank(id?: string, questionId?: string): Promise<void>;
  navigate(id: string): Promise<void>;
  refreshBank(): Promise<void>;
}

export interface PracticeActions extends PracticeViewActions {
  update(q: Question, preserveStatus?: boolean): void;
  context(q: Question): PageContext;
  applyCompletion(value: Completion): void;
  pictures(q: Question, has?: (id: string) => boolean): Promise<Picture[]>;
  disposePage(): void;
  applyContext(q: Question): Promise<void>;
  show(q: Question, resume?: boolean): Promise<void>;
  createSaver(q: Question, mine: number, instance: QuestionPage): Saver;
  reloadAfterConflict(q: Question, mine: number, error?: unknown): Promise<Question | null>;
  score(q: Question): Promise<Question>;
  grade(q: Question): Promise<void>;
  submit(): Promise<void>;
  retry(): Promise<void>;
  recoverPending(value: Overview): Promise<void>;
  reloadCompletedQuestion(): Promise<void>;
  gradeCompleted(value: Overview): Promise<void>;
  scopeSources(bankId: string, snapshotId: string): void;
  initializeRuntime(nonce: string): void;
  remember(q: Question): void;
}
export interface PracticeSession extends PracticeWorkspace {
  current: Ref<Question | null>;
  typeName: Ref<string>;
  saveStatus: Ref<string>;
  recovering: Ref<boolean>;
  drafting: Ref<boolean>;
  scoreView: Ref<boolean>;
  drawer: Ref<'library' | 'outline' | null>;
  authRequired: Ref<boolean>;
  lastQuestions: Ref<Map<string, string>>;
  catalogStore: { read(catalog: PracticeApi['catalog']): Promise<void> };
  runtime: PracticeRuntime;
  actions(): PracticeActions;
}
