import { mountWhiteboard } from '../../../../web/draft/whiteboard';
import { createDraftFullscreen } from '../../../../web/draft/draft-fullscreen';
import '../../../../web/draft/whiteboard.css';

// Host-only adapter: the v1 pen, selection, camera, dock and tools are unchanged.
// No answer-area registration/channel: all strokes here are scratch ink.
function createScratchLayout(
  viewport: HTMLElement,
  stage: HTMLElement,
  world: HTMLElement,
  options: { changed(): void; error(error: Error): void },
) {
  const state = { drafting: false, history: false, loading: false };
  const shell = viewport.closest('.v2-app');
  const fullscreen = createDraftFullscreen(document, {
    canEnter: () => state.drafting,
    onChange: (state) => {
      shell?.classList.toggle('v2-fullscreen', state.active);
      board.setFullscreenState(state);
    },
    onError: options.error,
  });
  const resize = () => {
    // Scratch editing and history use fixed coordinates; live practice stays fluid.
    const fixed = state.drafting || state.history;
    const zoom = fixed ? board.getViewCamera().zoom : 1;
    const y = fixed ? Math.max(0, board.getViewCamera().y * zoom) : 0;
    stage.style.height = `${Math.max(viewport.clientHeight, world.offsetHeight * zoom + y + 32)}px`;
  };
  const board = mountWhiteboard(viewport, {
    toolbarObstacles: () =>
      viewport.parentElement?.querySelectorAll<HTMLElement>('.v2-side-nav') ?? [],
    onChange() {
      resize();
      if (!state.loading) {
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
  return { state, shell, fullscreen, resize, board, observer };
}

function scratchMode(layout: ReturnType<typeof createScratchLayout>, viewport: HTMLElement) {
  const { board, state, resize, fullscreen } = layout;
  board.setReadOnly(state.history && !state.drafting);
  viewport.classList.toggle('v2-history-replay', state.history && !state.drafting);
  viewport.classList.toggle('v2-drafting', state.drafting || state.history);
  // History keeps the archived coordinate space even outside scratch editing.
  board.setMode(state.drafting || state.history ? 'draft' : 'practice');
  fullscreen.sync();
  resize();
}

export function mountScratch(
  viewport: HTMLElement,
  stage: HTMLElement,
  world: HTMLElement,
  options: { changed(): void; error(error: Error): void },
) {
  const layout = createScratchLayout(viewport, stage, world, options);
  const { state, shell, fullscreen, resize, board, observer } = layout;
  return {
    setReadOnly(value: boolean) {
      state.history = value;
      scratchMode(layout, viewport);
    },
    load(ink: unknown) {
      state.loading = true;
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
        state.loading = false;
      }
    },
    setMode(value: boolean) {
      state.drafting = value;
      scratchMode(layout, viewport);
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
