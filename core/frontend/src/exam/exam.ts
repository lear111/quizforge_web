// Display snapshots only: exam attempts, host panes and timers stay in the host.
export interface ExamRecord {
  id: string; title: string; detail: string; badge: string; deleteLabel: string;
}
export interface ExamModel {
  busy: boolean; startHidden: boolean; startDisabled: boolean;
  statusHidden: boolean; status: string; submitHidden: boolean;
  submitDisabled: boolean; submitLabel: string; backHidden: boolean;
  error: string; rows: ExamRecord[]; deleteDetail: string;
}
export interface ExamFields { duration: string; unlimited: boolean }
export interface ExamActions {
  start(): Promise<void>; create(): Promise<void>; submit(): Promise<void>;
  back(): void; close(): void; resume(id: string): Promise<void>;
  remove(id: string): Promise<void>; decide(accepted: boolean): void;
}
