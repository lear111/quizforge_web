import { mountWhiteboard } from '../../../../web/draft/whiteboard';
import { createDraftFullscreen } from '../../../../web/draft/draft-fullscreen';
import '../../../../web/draft/whiteboard.css';

// Host-only adapter: the v1 pen, selection, camera, dock and tools are unchanged.
// No answer-area registration/channel: all strokes here are scratch ink.
export function mountScratch(
  viewport: HTMLElement,
  stage: HTMLElement,
  world: HTMLElement,
  options: { changed(): void; error(error: Error): void },
) {
  let drafting = false,
    loading = false;
  const shell = viewport.closest('.v2-app');
  const fullscreen = createDraftFullscreen(document, {
    canEnter: () => drafting,
    onChange: (state) => {
      shell?.classList.toggle('v2-fullscreen', state.active);
      board.setFullscreenState(state);
    },
    onError: options.error,
  });
  const resize = () => {
    // Only the draft view uses the fixed coordinate space; practice stays fluid.
    const zoom = drafting ? board.getViewCamera().zoom : 1;
    const y = drafting ? Math.max(0, board.getViewCamera().y * zoom) : 0;
    stage.style.height = `${Math.max(viewport.clientHeight, world.offsetHeight * zoom + y + 32)}px`;
  };
  const board = mountWhiteboard(viewport, {
    toolbarObstacles: () =>
      viewport.parentElement?.querySelectorAll<HTMLElement>('.v2-side-nav') ?? [],
    onChange() {
      resize();
      if (!loading) {
        options.changed();
      }
    },
    onViewChange: resize,
    onFullscreen: () => {
      void fullscreen.toggle();
    },
    onScroll: resize,
  });
  const observer = new ResizeObserver(resize);
  observer.observe(viewport);
  observer.observe(world);
  board.setFullscreenState(fullscreen.getState());
  return {
    load(ink: unknown) {
      loading = true;
      try {
        board.load(ink ?? null);
        // Layout is a host preference for this question, not an empty ink save.
        if (!ink) {
          const zoom = Math.max(0.25, Math.min(1, (viewport.clientWidth - 24) / 760));
          board.setViewport(
            { x: (viewport.clientWidth / zoom - 760) / 2, y: 0, zoom },
            { emit: false },
          );
        }
        resize();
      } finally {
        loading = false;
      }
    },
    setMode(value: boolean) {
      drafting = value;
      viewport.classList.toggle('v2-drafting', value);
      board.setMode(value ? 'draft' : 'practice');
      fullscreen.sync();
      resize();
    },
    getDraft: () => ({ ...board.getDraft(), viewport: board.getViewCamera() }),
    flush: () => board.flush(),
    destroy() {
      observer.disconnect();
      fullscreen.destroy();
      shell?.classList.remove('v2-fullscreen');
      board.destroy();
    },
  };
}
