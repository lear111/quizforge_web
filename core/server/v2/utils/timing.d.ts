export type SavePhase = 'parse' | 'validate' | 'serialize' | 'write' | 'other';
export type OverviewPhase =
  | 'locate-bank'
  | 'bank-tree'
  | 'bank-json'
  | 'extension-scan'
  | 'extension-resolve'
  | 'sdk-digest'
  | 'snapshot-id'
  | 'content-fingerprint'
  | 'state-check'
  | 'ink-index'
  | 'ink-body'
  | 'assemble'
  | 'serialize'
  | 'other';
export function withSaveTiming<T>(enabled: boolean, action: () => T): T;
export function withOverviewTiming<T>(enabled: boolean, action: () => T): T;
export function measureSave<T>(phase: SavePhase, action: () => T): T;
export function measureOverview<T>(phase: OverviewPhase, action: () => T): T;
export function measureResponseSerialization<T>(action: () => T): T;
export function timingHeader(): string | null;
