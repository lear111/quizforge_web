import type { Item, State } from './outline';
export interface Question { bankId: string; questionId: string; snapshotId: string; question: unknown; solution: unknown; answer: unknown; ink: unknown; inkRevision: number; resources: { assetId: string; reference: string }[]; result: { score: number | null; parts: Record<string, number> | null; message: string | null } | null; submissionId: string | null; item: Item; extension: { artifactId: string }; state: State }
export interface Overview { bank: { bankId: string; title: string }; snapshotId: string; outline: { title: string; items: Item[] }[]; states: State[]; initial: { question: Question | null; error: { message: string } | null }; notice?: string | null; pendingGrading: { question: Question | null; error: { message: string } | null }[] }

export interface PracticeWorkspace {
  overview: import('vue').Ref<Overview | null>;
  message: import('vue').Ref<string>;
  busy: import('vue').Ref<boolean>;
  token: import('vue').Ref<string>;
  response(route: string, options?: RequestInit): Promise<Response>;
  json(route: string, options?: RequestInit): Promise<any>;
  run(label: string, action: () => Promise<void>): Promise<void>;
  remember(question: Question): void;
}
