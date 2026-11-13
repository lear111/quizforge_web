import type { FullscreenState } from './whiteboard';
export function createDraftFullscreen(doc: Document, options?: { canEnter?(): boolean; onChange?(state: FullscreenState): void; onError?(error: Error): void }): {
  toggle(): Promise<boolean>; sync(): FullscreenState; getState(): FullscreenState; destroy(): void;
};
