export type WorkspaceCommand = 'draft' | 'history' | 'edit';
export interface WorkspaceModel {
  title: string; group: string; progress: string; busy: boolean;
  draftHidden: boolean; drafting: boolean; draftLabel: string;
  historyHidden: boolean; editHidden: boolean;
}
