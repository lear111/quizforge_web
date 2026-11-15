import type { Answered } from '../../../../../shared/v2/answered.js';
// Each question gets its own opaque page. No state or solution crosses frames.
export interface PageContext {
  question: unknown;
  answer: unknown;
  solution: unknown;
  result: unknown;
  item: { parts?: { id: string }[] };
  locked: boolean;
  can: { submit: boolean; retry: boolean };
  appearance: { theme: 'light' | 'dark' };
}
export interface PageSources {
  html: string;
  js: string;
  css: string;
  sdks: string[];
}
export interface Picture {
  assetId: string;
  reference: string;
  bytes: ArrayBuffer;
  type: string;
}
export interface PageOptions {
  title?: string;
  resources?: Picture[];
  onChanged?(kind: InputKind, answered?: Answered): void;
  onSubmit?(): Promise<void>;
  onRetry?(): Promise<void>;
}

export type InputKind = 'choice' | 'text' | 'ink';
export type PageAction = 'submit' | 'retry';
// Incoming fields remain unknown until the existing per-message checks run.
export interface PageMessage {
  channel?: unknown;
  version?: unknown;
  kind?: unknown;
  inputKind?: unknown;
  answered?: unknown;
  height?: unknown;
  action?: unknown;
  request?: unknown;
  error?: unknown;
  value?: unknown;
}
export interface PendingRequest {
  kind: 'answer' | 'updated';
  resolve(value: unknown): void;
  reject(error: Error): void;
}
export interface PageSession {
  frame: HTMLIFrameElement;
  channel: string;
  context: PageContext;
  initialContext: PageContext;
  disposed: boolean;
  faulted: boolean;
  initialized: boolean;
  actionRunning: boolean;
  version: number;
  sequence: number;
  sent: Set<string>;
  pending: Map<unknown, PendingRequest>;
  ready: Promise<void>;
  latest: Promise<void>;
  resolveReady(): void;
  rejectReady(error: Error): void;
}
