import type { ReadBank, BankLocation, Snapshot, CurrentState } from './data.js';
export interface HistoryRound extends ReadBank, BankLocation {
  sourceDirectory: string;
  roundId: string;
  state: CurrentState & { completedAt: string; contentFingerprint: string };
}
export interface HistorySnapshot {
  round: HistoryRound;
  snapshot: Snapshot;
}
