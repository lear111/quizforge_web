export interface LibraryItem {
  id?: string;
  path?: string;
  group?: string;
  title?: string;
  name?: string;
  kind?: string;
  format?: string;
  size?: number;
  questionCount?: number;
  version?: string;
  development?: unknown;
  error?: string | { message: string };
}
export type LibraryTree =
  | { kind: 'group'; name: string; path: string; expanded: boolean; children: LibraryTree[] }
  | { kind: 'extension'; row: LibraryItem };
export interface LibraryProps {
  mode: string;
  activeKey: string | null;
  canManage: boolean;
}
export type LibraryEvents = {
  toggleGroup: [path: string];
  notice: [message: string];
  open: [kind: string, id: string | undefined];
  manage: [target: string, row: LibraryItem, action: string];
};
// The V1 imperative renderer passes Vue event listeners using these names.
export interface LibraryActions extends LibraryProps {
  onToggleGroup(path: string): void;
  onNotice(message: string): void;
  onOpen(kind: string, id: string | undefined): void;
  onManage(target: string, row: LibraryItem, action: string): void;
}
export const itemKind = (row: LibraryItem, mode: string) =>
  row.kind === 'document' ? 'document' : row.kind?.startsWith('development') ? row.kind : mode;
export const errorMessage = (row: LibraryItem) =>
  typeof row.error === 'string' ? row.error : row.error?.message;
