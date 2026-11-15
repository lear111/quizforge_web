export interface GradingInput {
  questionId: string;
  question: unknown;
  solution: unknown;
  answer: unknown;
  item: unknown;
}
import type { GradeResult } from '../../../../../shared/v2/state.js';
export type { GradeResult } from '../../../../../shared/v2/state.js';
export interface GradingOutput {
  questionId: string;
  result: GradeResult;
}
export interface GradingOptions {
  loadSource(artifactId: string, signal: AbortSignal): Promise<string>;
  document?: Document;
  timeoutMs?: number;
  idleMs?: number;
  /** Trusted host boot-script nonce, so srcdoc also satisfies the parent CSP. */
  scriptNonce?: string;
}

// Private runtime state is owned by one service or one artifact slot.
export interface Environment {
  frame: HTMLIFrameElement;
  ready: Promise<void>;
  run(items: GradingInput[]): Promise<unknown>;
  destroy(): void;
}
export interface Slot {
  environment: Environment | null;
  tail: Promise<unknown>;
  cancel: (() => void) | null;
  idleTimer: ReturnType<typeof setTimeout> | null;
}
export interface Pool {
  options: GradingOptions;
  doc: Document;
  timeoutMs: number;
  idleMs: number;
  slots: Map<string, Slot>;
  closed: boolean;
}
