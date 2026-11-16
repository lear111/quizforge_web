import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import { fileURLToPath } from 'node:url';

// Exercise the actual V2 adapter; the existing V1 board is only a DOM-free boundary here.
const compiled = await build({
  entryPoints: [
    fileURLToPath(new URL('../../frontend/src/v2/services/whiteboard.ts', import.meta.url)),
  ],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  loader: { '.css': 'empty' },
  plugins: [
    {
      name: 'board-boundary',
      setup(build) {
        build.onLoad({ filter: /[\\/]draft[\\/]whiteboard\.js$/ }, () => ({
          contents: 'export function mountWhiteboard(viewport) { return viewport.board; }',
        }));
        build.onLoad({ filter: /draft-fullscreen\.js$/ }, () => ({
          contents: `export function createDraftFullscreen() {
          return {getState: () => ({}), sync() {}, destroy() {}};
        }`,
        }));
      },
    },
  ],
});
const { mountScratch } = await import(
  'data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64')
);

function fixture(t) {
  const dom = new JSDOM(
    '<div class="v2-app"><div id="viewport"><div id="stage"><div id="world"></div></div></div></div>',
  );
  const previous = { document: globalThis.document, ResizeObserver: globalThis.ResizeObserver };
  globalThis.document = dom.window.document;
  globalThis.ResizeObserver = class {
    observe() {}
    disconnect() {}
  };
  t.after(() => {
    Object.assign(globalThis, previous);
    dom.window.close();
  });
  const viewport = dom.window.document.getElementById('viewport'),
    stage = dom.window.document.getElementById('stage'),
    world = dom.window.document.getElementById('world');
  Object.defineProperty(viewport, 'clientHeight', { value: 500 });
  Object.defineProperty(world, 'offsetHeight', { value: 600 });
  let ink;
  const board = {
    setMode(value) {
      this.mode = value;
    },
    setReadOnly(value) {
      this.readOnly = value;
    },
    getViewCamera: () => ink.viewport,
    getDraft: () => structuredClone(ink),
    load(value) {
      ink = structuredClone(value);
    },
    flush() {},
    destroy() {},
    setFullscreenState() {},
  };
  viewport.board = board;
  const scratch = mountScratch(viewport, stage, world, {
    changed: () => assert.fail('changing display modes must not save ink'),
    error: assert.fail,
  });
  t.after(() => scratch.destroy());
  const archived = { strokes: ['archived ink'], viewport: { x: 120, y: 300, zoom: 2 } };
  scratch.load(archived);
  return { scratch, viewport, stage, board, archived };
}

test('history defaults to fluid answer layout and only draft mode enables the fixed editable board', (t) => {
  const { scratch, viewport, stage, board, archived } = fixture(t);
  scratch.setReadOnly(true);
  assert.equal(board.mode, 'practice');
  assert.equal(board.readOnly, true);
  assert.equal(viewport.classList.contains('v2-drafting'), false);
  assert.equal(stage.style.height, '632px');
  scratch.setMode(true);
  assert.equal(board.mode, 'draft');
  assert.equal(board.readOnly, false);
  assert.equal(viewport.classList.contains('v2-drafting'), true);
  assert.equal(stage.style.height, '1832px');
  scratch.setMode(false);
  assert.equal(board.mode, 'practice');
  assert.equal(board.readOnly, true);
  assert.equal(viewport.classList.contains('v2-drafting'), false);
  assert.equal(stage.style.height, '632px');
  assert.deepEqual(scratch.getDraft(), archived);
});

test('loading another history question preserves the selected mode and archived camera without saving', (t) => {
  const { scratch, viewport, board, archived } = fixture(t);
  scratch.setReadOnly(true);
  for (const drafting of [false, true]) {
    scratch.setMode(drafting);
    const next = { strokes: ['other question'], viewport: { x: 40, y: 80, zoom: 0.5 } };
    scratch.load(next);
    scratch.setReadOnly(true);
    assert.equal(board.mode, drafting ? 'draft' : 'practice');
    assert.equal(board.readOnly, !drafting);
    assert.equal(viewport.classList.contains('v2-drafting'), drafting);
    assert.deepEqual(scratch.getDraft(), next);
    scratch.load(archived);
    assert.deepEqual(scratch.getDraft(), archived);
  }
  scratch.setReadOnly(false);
  scratch.setMode(false);
  assert.equal(board.mode, 'practice');
  assert.equal(board.readOnly, false);
  scratch.setMode(true);
  assert.equal(board.mode, 'draft');
  assert.equal(board.readOnly, false);
});
