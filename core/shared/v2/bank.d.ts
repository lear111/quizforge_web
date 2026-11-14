/** D46 deliberately leaves display metadata unchecked. Preserve it as unknown;
 * these declarations do not turn a parsed file into validated author data. */
export interface OutlinePart {
  id: string;
  label?: unknown;
  maxScore: number;
}
export interface OutlineItem {
  id: string;
  label?: unknown;
  maxScore?: number;
  parts?: OutlinePart[];
  listening?: unknown;
}
export interface OutlineGroup {
  title?: unknown;
  items: OutlineItem[];
}
export interface ListeningMaterial {
  title?: unknown;
  src: unknown;
}
export interface BankQuestion {
  type: string;
  question: unknown;
  solution: unknown;
}
export interface BankFile {
  formatVersion?: unknown;
  id?: unknown;
  title?: unknown;
  description?: unknown;
  features?: unknown;
  outline: OutlineGroup[];
  questions?: Record<string, BankQuestion>;
  listening?: Record<string, ListeningMaterial>;
}
export interface BankInfo {
  bankId: string;
  sourceId: unknown;
  title: unknown;
  description: unknown;
  features: { history: unknown; exam: unknown };
}
