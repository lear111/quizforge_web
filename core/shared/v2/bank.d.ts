/** Authoring structure, not a claim that an untrusted parsed file is valid. */
export interface OutlinePart {
  id: string;
  label?: string;
  maxScore: number;
}
export interface OutlineItem {
  id: string;
  label?: string;
  maxScore?: number;
  parts?: OutlinePart[];
  listening?: string;
}
export interface OutlineGroup {
  title?: string;
  items: OutlineItem[];
}
export interface ListeningMaterial {
  title?: string;
  src: string;
}
export interface BankQuestion {
  type: string;
  question: unknown;
  solution: unknown;
}
export interface BankFile {
  formatVersion?: number;
  id?: string;
  title?: string;
  description?: string;
  features?: { history?: boolean; exam?: boolean };
  outline: OutlineGroup[];
  questions?: Record<string, BankQuestion>;
  listening?: Record<string, ListeningMaterial>;
}
export interface BankInfo {
  bankId: string;
  sourceId: string;
  title: string;
  description: string;
  features: { history: boolean; exam: boolean };
}
