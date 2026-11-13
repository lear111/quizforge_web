export interface Viewport { x: number; y: number; zoom: number }
export interface Draft { schemaVersion: 1; viewport: Viewport; strokes: unknown[]; layout?: { width: number; padding?: number; top?: number }; paper: { color: string; pattern: string } }
export interface FullscreenState { supported: boolean; active: boolean; pending: boolean }
export function mountWhiteboard(container: HTMLElement, options?: {
  onChange?(draft: Draft): void; onViewChange?(view: Viewport): void;
  onInteractionChange?(active: boolean): void; onFullscreen?(): void; onScroll?(): void;
  toolbarContainer?: HTMLElement | null; toolbarObstacles?(): { left: number; top: number; width: number; height: number }[];
}): {
  load(draft: unknown): void; getDraft(): Draft; getLayout(): Draft['layout'];
  setMode(mode: 'draft' | 'practice'): void; setReadOnly(value: boolean): void;
  setViewport(view: Viewport, options?: { emit?: boolean }): boolean;
  setViewCamera(view: Viewport | null): boolean;
  getViewCamera(): Viewport;
  setFullscreenState(state: FullscreenState): void;
  flush(): Draft; destroy(): void;
};
