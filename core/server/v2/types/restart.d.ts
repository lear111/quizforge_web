export interface RestartReceipt {
  requestKey: string;
  snapshotId: string;
  roundId: string;
  /** Absent on practice journals (including all before K). */
  scope?: 'exam';
}
export interface RestartJournal extends RestartReceipt {
  phase: 'prepared' | 'committed';
  previous: RestartReceipt | null;
}
