import type { Item, State } from '../services/outline';
import type { Ref } from 'vue';
import type { PracticeApi } from '../api';
export interface Question {
  bankId: string;
  questionId: string;
  snapshotId: string;
  question: unknown;
  solution: unknown;
  answer: unknown;
  ink: unknown;
  inkRevision: number;
  resources: { assetId: string; reference: string }[];
  result: {
    score: number | null;
    parts: Record<string, number> | null;
    message: string | null;
  } | null;
  submissionId: string | null;
  item: Item;
  extension: { artifactId: string };
  state: State;
}
export interface Completion {
  completedAt: string | null;
  states: State[];
  total: { score: number; maxScore: number };
  pendingGrading?: { question: Question | null; error: { message: string } | null }[];
}
export interface Overview extends Completion {
  bank: { bankId: string; title: string };
  snapshotId: string;
  outline: { title: string; items: Item[] }[];
  initial: { question: Question | null; error: { message: string } | null };
  notice?: string | null;
  pendingGrading: { question: Question | null; error: { message: string } | null }[];
}

export interface PracticeWorkspace {
  overview: Ref<Overview | null>;
  message: Ref<string>;
  busy: Ref<boolean>;
  token: Ref<string>;
  api: PracticeApi;
  run(label: string, action: () => Promise<void>): Promise<void>;
}
