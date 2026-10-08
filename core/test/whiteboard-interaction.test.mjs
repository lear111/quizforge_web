import test from 'node:test';
import assert from 'node:assert/strict';
import { mountWhiteboard } from '../web/whiteboard.js';
import { emptyDraft } from '../web/whiteboard-model.js';

// A small DOM/event fixture keeps pointer lifecycle tests independent of a browser
// install. It implements DOM plumbing only; all gesture behavior runs in the module.
class Element {
  constructor(tag, document) {
    this.tagName = tag.toUpperCase(); this.ownerDocument = document;
    this.children = []; this.parentElement = null; this.attributes = {};
    this.dataset = {}; this.style = {
      setProperty(name, value) { this[name] = value; },
      getPropertyValue(name) { return this[name] || ''; },
      getPropertyPriority() { return ''; },
      removeProperty(name) { delete this[name]; },
    }; this.listeners = new Map(); this.captures = new Set();
    this.hidden = false; this.checked = false; this.value = ''; this.disabled = false;
    this.scrollLeft = 0; this.scrollTop = 0;
    this.classList = { toggle: (name, enabled) => {
      const names = new Set(this.className.split(/\s+/).filter(Boolean));
      if (enabled) names.add(name); else names.delete(name);
      this.className = [...names].join(' ');
    } };
  }
  get className() { return this.attributes.class || ''; }
  set className(value) { this.attributes.class = value; }
  set innerHTML(html) {
    this.children = [];
    const stack = [this], voidTags = new Set(['input', 'br', 'hr']);
    for (const match of html.matchAll(/<\/?([a-z][\w-]*)([^>]*)>/gi)) {
      const closing = match[0].startsWith('</'), tag = match[1].toLowerCase();
      if (closing) { stack.pop(); continue; }
      const child = new Element(tag, this.ownerDocument);
      for (const attribute of match[2].matchAll(/([\w-]+)(?:="([^"]*)")?/g)) child.setAttribute(attribute[1], attribute[2] ?? '');
      stack[stack.length - 1].append(child);
      if (!voidTags.has(tag)) stack.push(child);
    }
  }
  setAttribute(name, value) {
    this.attributes[name] = String(value);
    if (name.startsWith('data-')) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
    if (name === 'value') this.value = value;
    if (name === 'hidden') this.hidden = true;
    if (name === 'checked') this.checked = true;
    if (name === 'tabindex') this.tabIndex = Number(value);
  }
  matches(selector) {
    if (selector.startsWith('.')) return this.className.split(/\s+/).includes(selector.slice(1));
    const attribute = selector.match(/^\[([\w-]+)(?:="([^"]+)")?\]$/);
    if (attribute) return attribute[2] == null ? Object.hasOwn(this.attributes, attribute[1]) : this.attributes[attribute[1]] === attribute[2];
    return this.tagName.toLowerCase() === selector;
  }
  querySelectorAll(selector) { return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector) || null; }
  contains(child) { return child === this || this.children.some(item => item.contains(child)); }
  append(child) { child.remove(); child.parentElement = this; this.children.push(child); }
  remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this); this.parentElement = null; }
  addEventListener(type, callback) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(callback); }
  removeEventListener(type, callback) { this.listeners.get(type)?.delete(callback); }
  dispatch(type, properties = {}) {
    const event = { target: this, preventDefault() { this.defaultPrevented = true; }, ...properties, type };
    for (let element = this; element; element = element.parentElement) {
      for (const callback of element.listeners.get(type) || []) callback(event);
    }
    return event;
  }
  get clientWidth() { return 800; }
  get clientHeight() { return 600; }
  getBoundingClientRect() { return { left: 0, top: 0, width: 800, height: 600 }; }
  getContext() {
    if (!this.context) this.context = {
      transform: [1, 0, 0, 1, 0, 0],
      setTransform(...values) { this.transform = values; },
      clearRect() {}, beginPath() {}, fill() {}, moveTo() {}, quadraticCurveTo() {}, stroke() {},
      arc(x, y, radius) {
        this.lastArc = { x, y, radius, screenX: this.transform[0] * x + this.transform[4], screenY: this.transform[3] * y + this.transform[5] };
      },
    };
    return this.context;
  }
  setPointerCapture(id) { this.captures.add(id); }
  hasPointerCapture(id) { return this.captures.has(id); }
  releasePointerCapture(id) { this.captures.delete(id); this.dispatch('lostpointercapture', { pointerId: id }); }
  focus() { this.ownerDocument.activeElement = this; }
}

function fixture({ externalToolbar = false, onFullscreen = () => {} } = {}) {
  const document = { createElement(tag) { return new Element(tag, this); }, querySelector() { throw new Error('Global queries are forbidden'); } };
  const window = new Element('window', document);
  let sequence = 0;
  const frames = new Map();
  window.requestAnimationFrame = callback => { const id = ++sequence; frames.set(id, callback); return id; };
  window.cancelAnimationFrame = id => frames.delete(id);
  const paint = () => { const callbacks = [...frames.values()]; frames.clear(); for (const callback of callbacks) callback(); };
  window.devicePixelRatio = 2;
  window.ResizeObserver = class { observe() {} disconnect() {} };
  document.defaultView = window;
  const container = document.createElement('section');
  const toolbarContainer = externalToolbar ? document.createElement('div') : null;
  if (toolbarContainer) toolbarContainer.className = 'qf-whiteboard-tool-row';
  const changes = [], interactions = [];
  const board = mountWhiteboard(container, { toolbarContainer, onFullscreen, onChange: draft => changes.push(draft), onInteractionChange: active => interactions.push(active) });
  const root = container.children[0], canvas = root.querySelector('canvas');
  const pointer = (type, x, y, pointerType = 'pen', pointerId = 1) => canvas.dispatch(type, {
    pointerId, pointerType, clientX: x, clientY: y, pressure: 0.8, button: 0,
  });
  const click = selector => (root.querySelector(selector) || toolbarContainer?.querySelector(selector)).dispatch('click');
  return { board, root, canvas, container, toolbarContainer, changes, interactions, pointer, click, window, paint };
}

test('paper stays outside the ink overlay, follows scroll and draft mode, and is cleaned up', () => {
  const { board, root, container, paint, changes } = fixture();
  const paper = container.querySelector('.qf-whiteboard-paper');
  assert.equal(paper.parentElement, container);
  assert.equal(root.contains(paper), false);
  assert.equal(paper.hidden, true);
  board.setMode('draft'); paint();
  assert.equal(paper.hidden, false);
  assert.equal(paper.dataset.pattern, 'plain');
  assert.equal(paper.style.backgroundColor, '#ffffff');
  const draft = emptyDraft();
  draft.viewport = { x: 10, y: -20, zoom: 2 };
  draft.paper = { color: '#fff3ce', pattern: 'grid' };
  board.load(draft);
  container.scrollTop = 300; container.scrollLeft = 40;
  container.dispatch('scroll'); paint();
  assert.equal(paper.style.transform, 'translate(40px, 300px)');
  assert.equal(paper.style.backgroundPosition, '-20px -340px');
  assert.equal(paper.style.backgroundSize, '48px 48px');
  assert.equal(paper.style.backgroundColor, '#fff3ce');
  assert.equal(paper.dataset.pattern, 'grid');
  board.setMode('practice');
  assert.equal(paper.hidden, true);
  assert.deepEqual(board.getDraft(), draft);
  assert.equal(changes.length, 0);
  board.destroy();
  assert.equal(container.children.length, 0);
});

test('scroll repaints ink below the initial canvas height without changing the persisted camera', () => {
  const { board, root, canvas, container, changes, paint } = fixture();
  const draft = emptyDraft();
  draft.strokes.push({ id: 'below', color: '#334155', width: 4, points: [{ x: 20, y: 920, pressure: 0.5 }] });
  board.load(draft); paint();
  assert.ok(canvas.context.lastArc.screenY > canvas.height);
  container.scrollTop = 900; container.dispatch('scroll'); paint();
  assert.equal(root.style.transform, 'translate(0px, 900px)');
  assert.equal(canvas.context.lastArc.screenY, 40); // 20 visible CSS pixels at DPR 2.
  assert.ok(canvas.context.lastArc.screenY < canvas.height);
  assert.equal(container.style.getPropertyValue('--qf-whiteboard-y'), '0px');
  assert.deepEqual(board.getDraft(), draft);
  assert.equal(changes.length, 0);
  board.destroy();
  assert.equal(container.listeners.get('scroll').size, 0);
});

test('writing and panning after scroll use world coordinates and count scroll offset once', () => {
  const { board, container, pointer, click } = fixture();
  board.setViewport({ x: 10, y: -20, zoom: 2 }, { emit: false });
  container.scrollTop = 300; container.dispatch('scroll');
  board.setMode('draft');
  pointer('pointerdown', 40, 60); pointer('pointerup', 60, 80);
  assert.deepEqual(board.getDraft().strokes[0].points, [
    { x: 10, y: 200, pressure: 0.8 }, { x: 20, y: 210, pressure: 0.8 },
  ]);
  click('[data-tool="pan"]');
  pointer('pointerdown', 40, 60, 'mouse'); pointer('pointerup', 60, 90, 'mouse');
  assert.deepEqual(board.getDraft().viewport, { x: 20, y: -5, zoom: 2 });
});

test('pointer coordinates stay aligned when programmatic scroll precedes its scroll event', () => {
  const { board, root, canvas, container, pointer } = fixture();
  canvas.getBoundingClientRect = () => {
    const offset = root.style.transform.match(/translate\(([-\d.]+)px, ([-\d.]+)px\)/);
    return { left: Number(offset?.[1] || 0) - container.scrollLeft, top: Number(offset?.[2] || 0) - container.scrollTop, width: 800, height: 600 };
  };
  board.setMode('draft');
  container.scrollTop = 300;
  container.scrollLeft = 20;
  pointer('pointerdown', 40, 60); pointer('pointerup', 40, 60);
  assert.deepEqual(board.getDraft().strokes[0].points, [{ x: 60, y: 360, pressure: 0.8 }]);
  assert.equal(root.style.transform, 'translate(20px, 300px)');
});

test('wheel and pinch keep the world anchor under the pointer when the viewport is scrolled', () => {
  const wheel = fixture();
  wheel.container.scrollTop = 300;
  wheel.board.setMode('draft');
  wheel.canvas.dispatch('wheel', { clientX: 100, clientY: 100, deltaY: -50 });
  const camera = wheel.board.getDraft().viewport;
  assert.ok(Math.abs((100 + camera.x) * camera.zoom - 100) < 1e-9);
  assert.ok(Math.abs((400 + camera.y) * camera.zoom - 300 - 100) < 1e-9);
  const pinch = fixture();
  pinch.container.scrollTop = 300;
  pinch.board.setMode('draft');
  pinch.pointer('pointerdown', 100, 100, 'touch', 1);
  pinch.pointer('pointerdown', 200, 100, 'touch', 2);
  pinch.pointer('pointermove', 300, 100, 'touch', 2);
  pinch.pointer('pointerup', 300, 100, 'touch', 2);
  pinch.pointer('pointerup', 100, 100, 'touch', 1);
  assert.deepEqual(pinch.board.getDraft().viewport, { x: -50, y: -200, zoom: 2 });
  assert.equal(pinch.container.style.getPropertyValue('--qf-whiteboard-y'), '-400px');
  assert.equal(pinch.root.style.transform, 'translate(0px, 300px)');
  pinch.board.setMode('practice');
  assert.deepEqual(pinch.board.getDraft().viewport, { x: -50, y: -200, zoom: 2 });
  assert.equal(pinch.container.scrollTop, 300);
  assert.equal(pinch.board.getDraft().strokes.length, 0);
});

test('external toolbar moves outside overlay, remains functional and is removed on destroy', () => {
  const { board, root, toolbarContainer, changes, pointer, click } = fixture({ externalToolbar: true });
  const toolbar = toolbarContainer.querySelector('.qf-whiteboard-toolbar');
  assert.ok(toolbar);
  assert.equal(root.querySelector('.qf-whiteboard-toolbar'), null);
  assert.equal(toolbar.hidden, true);
  board.setMode('draft');
  assert.equal(toolbar.hidden, false);
  pointer('pointerdown', 5, 10); pointer('pointerup', 15, 20);
  click('[data-action="undo"]');
  assert.equal(board.getDraft().strokes.length, 0);
  click('[data-action="redo"]');
  assert.equal(board.getDraft().strokes.length, 1);
  click('[data-tool="eraser"]');
  assert.equal(toolbar.querySelector('[data-tool="eraser"]').attributes['aria-pressed'], 'true');
  click('[data-action="clear"]');
  assert.equal(root.querySelector('.qf-whiteboard-confirm').hidden, false);
  click('[data-action="confirm-clear"]');
  assert.equal(board.getDraft().strokes.length, 0);
  assert.equal(changes.length, 4);
  board.setMode('practice');
  assert.equal(toolbar.hidden, true);
  board.destroy();
  assert.equal(toolbarContainer.children.length, 0);
});

test('fullscreen toolbar action is limited to draft and follows browser state without changing saved ink', () => {
  let requests = 0;
  const { board, canvas, toolbarContainer, changes, click } = fixture({ externalToolbar: true, onFullscreen: () => requests++ });
  const toolbar = toolbarContainer.querySelector('.qf-whiteboard-toolbar');
  const button = toolbar.querySelector('[data-action="fullscreen"]');
  assert.equal(button.hidden, true);
  board.setFullscreenState({ supported: true, active: false, pending: false });
  assert.equal(toolbar.hidden, true);
  click('[data-action="fullscreen"]');
  assert.equal(requests, 0);
  const before = board.getDraft();
  board.setMode('draft');
  assert.equal(button.hidden, false);
  click('[data-action="fullscreen"]');
  assert.equal(requests, 1);
  board.setFullscreenState({ supported: true, active: true, pending: false });
  assert.equal(button.attributes['aria-label'], '退出全屏');
  assert.equal(button.attributes['aria-pressed'], 'true');
  const escape = canvas.dispatch('keydown', { key: 'Escape' });
  assert.ok(!escape.defaultPrevented, 'let the browser handle Escape to exit fullscreen');
  board.setFullscreenState({ supported: true, active: false, pending: true });
  assert.equal(button.disabled, true);
  assert.equal(button.attributes['aria-label'], '进入全屏');
  board.setMode('practice');
  assert.equal(toolbar.hidden, true);
  assert.deepEqual(board.getDraft(), before);
  assert.equal(changes.length, 0);
  board.destroy();
});

test('selection tool passes question input through without changing ink or camera and pen resumes writing', () => {
  const { board, root, canvas, toolbarContainer, changes, interactions, pointer, click } = fixture({ externalToolbar: true });
  const draft = emptyDraft();
  draft.viewport = { x: -30, y: 40, zoom: 1.5 };
  draft.strokes.push({ id: 'saved', color: '#334155', width: 4, points: [{ x: 10, y: 20, pressure: 0.5 }] });
  board.load(draft); board.setMode('draft');
  click('[data-tool="select"]');
  assert.equal(root.dataset.tool, 'select');
  assert.equal(toolbarContainer.querySelector('[data-tool="select"]').attributes['aria-pressed'], 'true');
  assert.equal(toolbarContainer.querySelector('[data-tool="pen"]').attributes['aria-pressed'], 'false');
  assert.equal(canvas.tabIndex, -1);
  for (const pointerType of ['pen', 'mouse', 'touch']) {
    const down = pointer('pointerdown', 20, 30, pointerType);
    pointer('pointermove', 100, 120, pointerType); pointer('pointerup', 100, 120, pointerType);
    assert.ok(!down.defaultPrevented);
  }
  const wheel = canvas.dispatch('wheel', { clientX: 100, clientY: 100, deltaY: -50 });
  const menu = canvas.dispatch('contextmenu');
  assert.ok(!wheel.defaultPrevented);
  assert.ok(!menu.defaultPrevented);
  assert.equal(canvas.captures.size, 0);
  assert.deepEqual(board.getDraft(), draft);
  assert.deepEqual(interactions, []);
  assert.equal(changes.length, 0);
  click('[data-tool="pen"]');
  assert.equal(canvas.tabIndex, 0);
  pointer('pointerdown', 20, 30); pointer('pointerup', 100, 120);
  assert.equal(board.getDraft().strokes.length, 2);
  assert.deepEqual(board.getDraft().strokes[0], draft.strokes[0]);
  assert.deepEqual(board.getDraft().viewport, draft.viewport);
  assert.equal(changes.length, 1);
  board.destroy();
});

test('V selects from the draft canvas without consuming input field, modified or practice shortcuts', () => {
  const { board, root, canvas, toolbarContainer, click } = fixture({ externalToolbar: true });
  const practiceKey = canvas.dispatch('keydown', { key: 'v' });
  assert.equal(root.dataset.tool, 'pen');
  assert.ok(!practiceKey.defaultPrevented);
  board.setMode('draft');
  const modified = canvas.dispatch('keydown', { key: 'v', ctrlKey: true });
  assert.equal(root.dataset.tool, 'pen');
  assert.ok(!modified.defaultPrevented);
  const field = toolbarContainer.querySelector('[data-control="ink-color"]');
  const fieldKey = canvas.dispatch('keydown', { key: 'v', target: field });
  assert.equal(root.dataset.tool, 'pen');
  assert.ok(!fieldKey.defaultPrevented);
  const key = canvas.dispatch('keydown', { key: 'V' });
  assert.equal(root.dataset.tool, 'select');
  assert.equal(key.defaultPrevented, true);
  assert.equal(canvas.tabIndex, -1);
  board.setMode('practice'); board.setMode('draft');
  assert.equal(canvas.tabIndex, -1);
  click('[data-tool="pen"]');
  assert.equal(canvas.tabIndex, 0);
  board.destroy();
});

test('floating settings preserve tool behavior, close on Escape and outside input, and reset between questions', () => {
  const { board, toolbarContainer, container, window, pointer, click } = fixture({ externalToolbar: true });
  const toolbar = toolbarContainer.querySelector('.qf-whiteboard-toolbar');
  const panel = toolbar.querySelector('.qf-whiteboard-settings');
  const toggle = toolbar.querySelector('[data-action="settings"]');
  board.setMode('draft');
  click('[data-action="settings"]');
  assert.equal(panel.hidden, false);
  assert.equal(toggle.attributes['aria-expanded'], 'true');
  const width = toolbar.querySelector('[data-control="width"]');
  assert.equal(container.ownerDocument.activeElement, width);
  width.value = '8'; width.dispatch('input');
  toolbar.querySelector('[data-control="pattern"]').value = 'grid';
  toolbar.querySelector('[data-control="pattern"]').dispatch('change');
  assert.equal(board.getDraft().paper.pattern, 'grid');
  width.dispatch('keydown', { key: 'Escape' });
  assert.equal(panel.hidden, true);
  assert.equal(container.ownerDocument.activeElement, toggle);
  pointer('pointerdown', 10, 10); pointer('pointerup', 20, 20);
  assert.equal(board.getDraft().strokes[0].width, 8);
  click('[data-action="settings"]');
  window.dispatch('pointerdown', { target: container });
  assert.equal(panel.hidden, true);
  click('[data-action="settings"]');
  board.load(null);
  assert.equal(panel.hidden, true);
  assert.equal(toggle.attributes['aria-expanded'], 'false');
  click('[data-action="settings"]');
  board.setMode('practice');
  assert.equal(panel.hidden, true);
});

test('clear confirmation disables the external strip until confirmed or cancelled', () => {
  const { board, toolbarContainer, root, pointer, click } = fixture({ externalToolbar: true });
  const toolbar = toolbarContainer.querySelector('.qf-whiteboard-toolbar');
  board.setMode('draft');
  pointer('pointerdown', 5, 10); pointer('pointerup', 15, 20);
  click('[data-action="settings"]'); click('[data-action="clear"]');
  assert.equal(toolbar.inert, true);
  assert.equal(root.querySelector('.qf-whiteboard-confirm').hidden, false);
  click('[data-action="undo"]');
  assert.equal(board.getDraft().strokes.length, 1);
  click('[data-action="cancel-clear"]');
  assert.equal(toolbar.inert, false);
  click('[data-action="clear"]');
  root.querySelector('[data-action="cancel-clear"]').dispatch('keydown', { key: 'Escape' });
  assert.equal(toolbar.inert, false);
  assert.equal(root.querySelector('.qf-whiteboard-confirm').hidden, true);
  click('[data-action="undo"]');
  assert.equal(board.getDraft().strokes.length, 0);
});

test('practice does not accept ink; desktop mouse remains writable with pen-only enabled', () => {
  const { board, root, canvas, changes, pointer } = fixture();
  assert.equal(canvas.tabIndex, -1);
  pointer('pointerdown', 5, 5, 'mouse'); pointer('pointerup', 15, 15, 'mouse');
  assert.equal(board.getDraft().strokes.length, 0);
  board.setMode('draft');
  assert.ok(root.className.includes('qf-whiteboard--draft'));
  pointer('pointerdown', 5, 5, 'mouse'); pointer('pointerup', 15, 15, 'mouse');
  assert.equal(board.getDraft().strokes.length, 1);
  assert.equal(changes.length, 1);
  assert.equal(board.getDraft().strokes[0].points[0].pressure, 0.5);
});

test('pointer cancel and unexpected capture loss discard preview ink and release all pointers', () => {
  for (const ending of ['pointercancel', 'lostpointercapture']) {
    const { board, canvas, changes, interactions, pointer } = fixture();
    board.setMode('draft');
    pointer('pointerdown', 10, 10); pointer('pointermove', 80, 80);
    assert.equal(changes.length, 0);
    pointer(ending, 80, 80);
    assert.equal(board.getDraft().strokes.length, 0);
    assert.equal(changes.length, 0);
    assert.equal(canvas.captures.size, 0);
    assert.deepEqual(interactions, [true, false]);
  }
});

test('flush commits a pending stylus once, including pressure, and a later pointerup does not duplicate it', () => {
  const { board, changes, interactions, pointer } = fixture();
  board.setMode('draft');
  pointer('pointerdown', 10, 20); pointer('pointermove', 30, 40);
  assert.equal(board.getDraft().strokes.length, 0);
  const flushed = board.flush();
  assert.equal(flushed.strokes.length, 1);
  assert.equal(flushed.strokes[0].points[0].pressure, 0.8);
  pointer('pointerup', 50, 60);
  assert.equal(board.getDraft().strokes.length, 1);
  assert.equal(changes.length, 1);
  assert.deepEqual(interactions, [true, false]);
});

test('single finger pans in pen-only mode and emits the camera only at gesture completion', () => {
  const { board, container, changes, pointer } = fixture();
  board.setMode('draft');
  pointer('pointerdown', 10, 20, 'touch'); pointer('pointermove', 110, 80, 'touch');
  assert.equal(changes.length, 0);
  assert.deepEqual(board.getDraft().viewport, { x: 100, y: 60, zoom: 1 });
  assert.equal(container.style.getPropertyValue('--qf-whiteboard-x'), '100px');
  assert.equal(container.style.getPropertyValue('--qf-whiteboard-y'), '60px');
  pointer('pointerup', 130, 100, 'touch');
  assert.equal(changes.length, 1);
  assert.equal(board.getDraft().strokes.length, 0);
  assert.deepEqual(board.getDraft().viewport, { x: 120, y: 80, zoom: 1 });
});

test('host camera CSS variables match ink camera during load, pinch and practice mode and clean up on destroy', () => {
  const { board, container, pointer } = fixture();
  const draft = emptyDraft();
  draft.viewport = { x: -12.5, y: 20, zoom: 2 };
  board.load(draft);
  assert.equal(container.style.getPropertyValue('--qf-whiteboard-x'), '-25px');
  assert.equal(container.style.getPropertyValue('--qf-whiteboard-y'), '40px');
  assert.equal(container.style.getPropertyValue('--qf-whiteboard-zoom'), '2');
  board.setMode('draft');
  pointer('pointerdown', 100, 100, 'touch', 1);
  pointer('pointerdown', 200, 100, 'touch', 2);
  pointer('pointermove', 250, 150, 'touch', 2);
  const camera = board.getDraft().viewport;
  assert.equal(container.style.getPropertyValue('--qf-whiteboard-x'), `${camera.x * camera.zoom}px`);
  assert.equal(container.style.getPropertyValue('--qf-whiteboard-y'), `${camera.y * camera.zoom}px`);
  assert.equal(container.style.getPropertyValue('--qf-whiteboard-zoom'), String(camera.zoom));
  board.setMode('practice');
  assert.deepEqual(board.getDraft().viewport, camera);
  assert.equal(container.style.getPropertyValue('--qf-whiteboard-zoom'), String(camera.zoom));
  board.destroy();
  assert.equal(container.style.getPropertyValue('--qf-whiteboard-x'), '');
  assert.equal(container.style.getPropertyValue('--qf-whiteboard-y'), '');
  assert.equal(container.style.getPropertyValue('--qf-whiteboard-zoom'), '');
});

test('host viewport adjustment fits a narrow screen and preserves world ink plus undo redo history', () => {
  const { board, container, changes, pointer, click } = fixture();
  board.setMode('draft');
  pointer('pointerdown', 20, 30); pointer('pointerup', 60, 70);
  const strokes = board.getDraft().strokes;
  const width = 497, logicalWidth = 760, zoom = (width - 24) / logicalWidth;
  const viewport = { x: (width / zoom - logicalWidth) / 2, y: 0, zoom };
  assert.equal(board.setViewport(viewport), true);
  assert.deepEqual(board.getDraft().strokes, strokes);
  assert.deepEqual(board.getDraft().viewport, viewport);
  assert.equal(changes.length, 2);
  assert.equal(container.style.getPropertyValue('--qf-whiteboard-x'), `${viewport.x * zoom}px`);
  assert.equal(container.style.getPropertyValue('--qf-whiteboard-zoom'), String(zoom));
  click('[data-action="undo"]');
  assert.equal(board.getDraft().strokes.length, 0);
  assert.deepEqual(board.getDraft().viewport, viewport);
  assert.equal(board.setViewport({ ...viewport, y: 5 }, { emit: false }), true);
  assert.equal(changes.length, 3);
  click('[data-action="redo"]');
  assert.deepEqual(board.getDraft().strokes, strokes);
  assert.deepEqual(board.getDraft().viewport, { ...viewport, y: 5 });
  assert.equal(board.setViewport({ ...viewport, y: 5 }), false);
  assert.equal(changes.length, 4);
});

test('practice camera centers question and ink independently while draft camera and undo remain intact', () => {
  const { board, container, canvas, changes, pointer, click, paint } = fixture();
  const loaded = emptyDraft();
  loaded.viewport = { x: -123, y: 77, zoom: 1.8 };
  board.load(loaded); board.setMode('draft');
  pointer('pointerdown', 10, 20); pointer('pointerup', 50, 60);
  const saved = board.getDraft(), serialized = JSON.stringify(saved);
  const camera = { x: 101, y: 88, zoom: 0.5 };
  assert.equal(board.setViewCamera(camera), true);
  camera.x = 999; // Host objects cannot later change the display camera.
  assert.deepEqual(board.getViewCamera(), saved.viewport);
  assert.equal(changes.length, 1);
  board.setMode('practice'); paint();
  assert.deepEqual(board.getViewCamera(), { x: 101, y: 88, zoom: 0.5 });
  assert.equal(container.style.getPropertyValue('--qf-whiteboard-x'), '50.5px');
  assert.equal(container.style.getPropertyValue('--qf-whiteboard-y'), '44px');
  assert.equal(container.style.getPropertyValue('--qf-whiteboard-zoom'), '0.5');
  const point = saved.strokes[0].points.at(-1);
  assert.ok(Math.abs(canvas.context.lastArc.screenX - (point.x + 101)) < 1e-9); // DPR 2 cancels zoom 0.5.
  assert.ok(Math.abs(canvas.context.lastArc.screenY - (point.y + 88)) < 1e-9);
  assert.equal(JSON.stringify(board.getDraft()), serialized);
  assert.equal(changes.length, 1);
  const returned = board.getViewCamera(); returned.zoom = 3;
  assert.equal(board.getViewCamera().zoom, 0.5);
  board.setMode('draft'); paint();
  assert.deepEqual(board.getViewCamera(), saved.viewport);
  assert.equal(container.style.getPropertyValue('--qf-whiteboard-x'), `${saved.viewport.x * saved.viewport.zoom}px`);
  assert.equal(changes.length, 1);
  click('[data-action="undo"]');
  assert.equal(board.getDraft().strokes.length, 0);
  assert.deepEqual(board.getDraft().viewport, saved.viewport);
  click('[data-action="redo"]');
  assert.equal(JSON.stringify(board.getDraft()), serialized);
});

test('practice layout resize and reset never save or rewrite the stored draft viewport', () => {
  const { board, container, changes } = fixture();
  const loaded = emptyDraft(); loaded.viewport = { x: -50, y: 240, zoom: 2 };
  board.load(loaded);
  assert.equal(board.setViewCamera({ x: 100, y: 30, zoom: 1 }), true);
  assert.equal(board.setViewCamera({ x: 100, y: 30, zoom: 1 }), false);
  assert.equal(board.setViewCamera({ x: 80, y: 40, zoom: 0.6 }), true);
  assert.deepEqual(board.getDraft(), loaded);
  assert.equal(changes.length, 0);
  assert.equal(container.style.getPropertyValue('--qf-whiteboard-zoom'), '0.6');
  assert.equal(board.setViewCamera(null), true);
  assert.equal(board.setViewCamera(null), false);
  assert.deepEqual(board.getViewCamera(), loaded.viewport);
  assert.deepEqual(board.flush(), loaded);
  assert.equal(changes.length, 0);
});

test('practice override stays separate when a saved draft is reloaded', () => {
  const { board, container, changes } = fixture();
  const camera = { x: 120, y: 70, zoom: 0.75 };
  board.setViewCamera(camera);
  const loaded = emptyDraft(); loaded.viewport = { x: -140, y: -240, zoom: 3 };
  loaded.strokes.push({ id: 'saved', color: '#334155', width: 4, points: [{ x: 20, y: 30, pressure: 0.5 }] });
  board.load(loaded);
  assert.deepEqual(board.getViewCamera(), camera);
  assert.deepEqual(board.getDraft(), loaded);
  assert.equal(container.style.getPropertyValue('--qf-whiteboard-x'), '90px');
  board.setMode('draft');
  assert.deepEqual(board.getViewCamera(), loaded.viewport);
  assert.equal(container.style.getPropertyValue('--qf-whiteboard-x'), '-420px');
  assert.equal(changes.length, 0);
});

test('display camera updates and invalid overrides leave active draft ink untouched', () => {
  const { board, changes, interactions, pointer } = fixture();
  board.setMode('draft');
  pointer('pointerdown', 5, 10); pointer('pointermove', 15, 20);
  assert.equal(board.setViewCamera({ x: 100, y: 70, zoom: 0.6 }), true);
  assert.throws(() => board.setViewCamera({ x: 0, y: 0, zoom: NaN }), TypeError);
  assert.equal(board.getDraft().strokes.length, 0);
  assert.equal(changes.length, 0);
  assert.deepEqual(interactions, [true]);
  assert.deepEqual(board.getViewCamera(), { x: 0, y: 0, zoom: 1 });
  pointer('pointerup', 25, 30);
  assert.equal(board.getDraft().strokes.length, 1);
  assert.equal(changes.length, 1);
  assert.deepEqual(interactions, [true, false]);
  board.setMode('practice');
  assert.deepEqual(board.getViewCamera(), { x: 100, y: 70, zoom: 0.6 });
  board.destroy();
  assert.equal(board.setViewCamera(null), false);
});

test('valid viewport adjustment finishes pending ink; invalid adjustment leaves gesture untouched', () => {
  const { board, changes, interactions, pointer } = fixture();
  board.setMode('draft');
  pointer('pointerdown', 5, 10); pointer('pointermove', 15, 20);
  assert.throws(() => board.setViewport({ x: 0, y: 0, zoom: NaN }), TypeError);
  assert.equal(board.getDraft().strokes.length, 0);
  assert.equal(changes.length, 0);
  assert.deepEqual(interactions, [true]);
  board.setViewport({ x: 0, y: 0, zoom: 0.6 }, { emit: false });
  assert.equal(board.getDraft().strokes.length, 1);
  assert.equal(changes.length, 1); // Ink always commits; only the layout camera write is muted.
  assert.deepEqual(interactions, [true, false]);
  assert.equal(board.getDraft().viewport.zoom, 0.6);
});

test('two-finger pinch discards first-finger writing and translates plus scales without ink', () => {
  const { board, root, changes, pointer } = fixture();
  board.setMode('draft');
  root.querySelector('[data-control="pen-only"]').checked = false;
  pointer('pointerdown', 100, 100, 'touch', 1);
  pointer('pointermove', 105, 100, 'touch', 1);
  pointer('pointerdown', 205, 100, 'touch', 2);
  pointer('pointermove', 305, 100, 'touch', 2);
  assert.equal(changes.length, 0);
  assert.equal(board.getDraft().viewport.zoom, 2);
  pointer('pointerup', 305, 100, 'touch', 2);
  pointer('pointerup', 105, 100, 'touch', 1);
  assert.equal(board.getDraft().strokes.length, 0);
  assert.equal(changes.length, 1);
  assert.equal(board.getDraft().viewport.zoom, 2);
});

test('a palm touch cannot replace active stylus ink; blur cancels unfinished work', () => {
  const first = fixture();
  first.board.setMode('draft');
  first.pointer('pointerdown', 20, 20);
  first.pointer('pointerdown', 300, 300, 'touch', 2);
  first.pointer('pointermove', 400, 400, 'touch', 2);
  first.pointer('pointerup', 50, 50);
  assert.equal(first.board.getDraft().strokes.length, 1);
  assert.deepEqual(first.board.getDraft().viewport, { x: 0, y: 0, zoom: 1 });
  first.pointer('pointerdown', 80, 80);
  first.window.dispatch('blur');
  assert.equal(first.board.getDraft().strokes.length, 1);
  assert.equal(first.changes.length, 1);
});

test('eraser cancel preserves ink; clear needs confirmation and remains undoable', () => {
  const { board, root, changes, pointer, click } = fixture();
  const draft = emptyDraft();
  draft.strokes.push({ id: 'line', color: '#334155', width: 4, points: [{ x: 0, y: 20, pressure: 0.5 }, { x: 100, y: 20, pressure: 0.5 }] });
  board.load(draft); board.setMode('draft');
  click('[data-tool="eraser"]');
  pointer('pointerdown', 50, 0); pointer('pointermove', 50, 40); pointer('pointercancel', 50, 40);
  assert.deepEqual(board.getDraft(), draft);
  click('[data-action="clear"]');
  assert.equal(root.querySelector('.qf-whiteboard-confirm').hidden, false);
  assert.equal(changes.length, 0);
  click('[data-action="cancel-clear"]');
  assert.equal(board.getDraft().strokes.length, 1);
  click('[data-action="clear"]'); click('[data-action="confirm-clear"]');
  assert.equal(board.getDraft().strokes.length, 0);
  assert.equal(changes.length, 1);
  click('[data-action="undo"]');
  assert.equal(board.getDraft().strokes.length, 1);
});

test('load cancels pending ink and resets history; destroy removes scoped DOM and event handlers', () => {
  const { board, root, container, changes, interactions, pointer } = fixture();
  board.setMode('draft');
  pointer('pointerdown', 1, 2); pointer('pointerup', 3, 4);
  pointer('pointerdown', 5, 6);
  board.load(null);
  assert.equal(board.getDraft().strokes.length, 0);
  assert.equal(root.querySelector('[data-action="undo"]').disabled, true);
  assert.equal(root.querySelector('[data-action="redo"]').disabled, true);
  assert.equal(changes.length, 1);
  assert.deepEqual(interactions, [true, false, true, false]);
  pointer('pointerdown', 7, 8);
  board.destroy();
  assert.equal(container.children.length, 0);
  pointer('pointerup', 9, 10);
  assert.equal(board.getDraft().strokes.length, 0);
  assert.equal(changes.length, 1);
});
