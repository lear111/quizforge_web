export type SaveKind = 'choice' | 'text' | 'ink';
export interface Clock {
  setTimeout(callback: () => void, ms: number): number;
  clearTimeout(id: number): void;
}
export interface Options<T> {
  read(): Promise<T>;
  /** Freeze the request ID, body and expected revision once, including retries. */
  prepare(value: T): () => Promise<void>;
  recovery?: { accepts(error: unknown): boolean; reload(error: unknown): Promise<void> };
  clock?: Clock;
  status?(value: 'unsaved' | 'saving' | 'saved' | 'failed' | 'recovered'): void;
  error?(error: unknown): void;
}

export interface SaveState {
  clock: Clock;
  version: number;
  saved: number;
  disposed: boolean;
  idle: number | undefined;
  deadline: number | undefined;
  pending: { version: number; run(): Promise<void> } | null;
  running: Promise<void> | null;
  reloading: boolean;
  recoveryError: unknown;
}
