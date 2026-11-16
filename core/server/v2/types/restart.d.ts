export interface RestartReceipt {
  requestKey: string;
  snapshotId: string;
  roundId: string;
}
export interface RestartJournal extends RestartReceipt {
  phase: 'prepared' | 'committed';
  previous: RestartReceipt | null;
}
