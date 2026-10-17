import { WhiteboardModel, DRAFT_LIMITS, normalizeViewport, screenToWorld, zoomAt, translateCamera, strokeTouchesPath } from './whiteboard-model.js';
import { rectangle, strokeBounds, containsPoint, enclosedStrokes, translateStrokes } from './whiteboard-selection.js';
import { copyCaptureImage } from './whiteboard-capture.js';
import { DEFAULT_TOOLBAR_DOCK, normalizeDock, dockedPosition, popupPosition, anchorLayout, isCornerAnchor, stepAnchor, isToolbarDrag, releaseVelocity, releaseDock, springStep, springSettled, TOOLBAR_SHRINK_MS, TOOLBAR_SPRING, TOOLBAR_SHAPE_SPRING } from './whiteboard-dock.js';

const INK_COLORS = [['#334155','深灰'],['#000000','黑色'],['#386db6','蓝色'],['#d04444','红色'],['#25865a','绿色'],['#8055bd','紫色']];
const PAPER_COLORS = [['#ffffff','白色'],['#fff8e7','米黄'],['#f0f7f0','浅绿'],['#edf4fc','浅蓝'],['#f5f1fa','浅紫']];
const swatches = (colors, kind) => colors.map(([color,label]) => `<button type="button" data-${kind}="${color}" aria-label="${kind==='ink'?'笔色':'纸色'}：${label}" title="${label}" aria-pressed="false" class="qf-whiteboard-swatch" style="--swatch:${color}"></button>`).join('');
const TOOLBAR_STORAGE_KEY = 'quizforge.whiteboard.toolbar';
// The question tool and the old pan tool are one tool now; keep their names working.
const TOOL_ALIASES = { select: 'hand', pan: 'hand' };
const READ_ONLY_TOOLS = ['hand', 'capture'];
const TOOL_LABELS = { hand: '操作／移动', pen: '画笔', eraser: '整笔擦除', 'select-ink': '框选笔迹', capture: '区域截图' };

const icons = {
  hand: '<path d="M18 11V6a2 2 0 0 0-4 0v4"></path><path d="M14 10V4a2 2 0 0 0-4 0v6"></path><path d="M10 10.5V6a2 2 0 0 0-4 0v8"></path><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.9-6-2.3l-3.6-3.6a2 2 0 0 1 2.8-2.8L7 15"></path>',
  pen: '<path d="m16 3 5 5-12 12-6 1 1-6L16 3Z"></path><path d="m14 5 5 5"></path>',
  eraser: '<path d="m14 3 7 7-10 10H6l-4-4L14 3Z"></path><path d="m7 11 7 7M11 20h11"></path>',
  undo: '<path d="M9 14 4 9l5-5"></path><path d="M4 9h11a5 5 0 0 1 0 10h-3"></path>',
  redo: '<path d="m15 14 5-5-5-5"></path><path d="M20 9H9a5 5 0 0 0 0 10h3"></path>',
  settings: '<path d="M4 6h16M4 12h16M4 18h16"></path><circle cx="9" cy="6" r="2"></circle><circle cx="15" cy="12" r="2"></circle><circle cx="8" cy="18" r="2"></circle>',
  fullscreen: '<path d="M8 3H3v5M16 3h5v5M21 16v5h-5M8 21H3v-5"></path>',
  exitFullscreen: '<path d="M3 8h5V3M16 3v5h5M21 16h-5v5M8 21v-5H3"></path>',
  width: '<path d="M4 5h16M4 12h16M4 19h16" stroke-width="1"></path><path d="M4 12h16" stroke-width="3"></path><path d="M4 19h16" stroke-width="5"></path>',
  paper: '<path d="M6 2h9l4 4v16H6V2Z"></path><path d="M14 2v5h5M9 12h7M9 16h7"></path>',
  grid: '<rect x="3" y="3" width="18" height="18" rx="2"></rect><path d="M3 9h18M3 15h18M9 3v18M15 3v18"></path>',
  stylus: '<path d="m15 3 6 6-10 10-7 2 2-7L15 3Z"></path><path d="m13 5 6 6M3 5v4M1 7h4"></path>',
  clear: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"></path>',
  close: '<path d="m6 6 12 12M6 18 18 6"></path>',
  'select-ink': '<rect x="4" y="4" width="16" height="16" rx="1" stroke-dasharray="3 3"></rect>',
  capture: '<path d="M8 3H3v5M16 3h5v5M21 16v5h-5M8 21H3v-5"></path><rect x="7" y="7" width="10" height="10" rx="1"></rect>',
  copy: '<rect x="8" y="8" width="13" height="13" rx="2"></rect><path d="M16 8V3H3v13h5"></path>',
};
const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${icons[name]}</svg>`;
const toolIcon = (name, color) => name === 'pen' ? `${icon('pen')}<span class="qf-whiteboard-pen-color" style="--swatch:${color}"></span>` : icon(name);

export function mountWhiteboard(container, { onChange = () => {}, onViewChange = () => {}, onInteractionChange = () => {}, onFullscreen = () => {}, onScroll = () => {}, onCapture = null, toolbarContainer = null, toolbarObstacles = () => [] } = {}) {
  if (!container?.ownerDocument) throw new TypeError('Whiteboard requires a DOM container');
  const doc = container.ownerDocument, win = doc.defaultView;
  if (toolbarContainer && (toolbarContainer.ownerDocument !== doc || typeof toolbarContainer.append !== 'function')) {
    throw new TypeError('Toolbar container must belong to the same document');
  }
  const model = new WhiteboardModel();
  const cameraProperties = ['--qf-whiteboard-x', '--qf-whiteboard-y', '--qf-whiteboard-zoom'];
  const previousCameraProperties = cameraProperties.map(name => ({
    name, value: container.style.getPropertyValue(name), priority: container.style.getPropertyPriority(name),
  }));
  const root = doc.createElement('div');
  root.className = 'qf-whiteboard qf-whiteboard--practice';
  root.innerHTML = `
    <div class="qf-whiteboard-paper" aria-hidden="true"></div>
    <canvas class="qf-whiteboard-ink" aria-label="题目草稿白板" tabindex="-1"></canvas>
    <div class="qf-whiteboard-toolbar" role="toolbar" aria-label="白板工具：按住任意位置可拖动，拖到角落收起；Alt 加方向键换位置" aria-orientation="vertical" data-side="right" data-collapsed="false">
      <button type="button" class="qf-whiteboard-expand" data-action="expand-toolbar" aria-label="展开白板工具" aria-expanded="false" title="点按展开白板工具；拖动可换位置" hidden></button>
      <div class="qf-whiteboard-group">
        <button type="button" data-tool="hand" title="操作／移动 (V / H)：点题目选项、输入框等可作答，拖动其他位置移动白板" aria-label="操作题目或移动白板" aria-pressed="false">${icon('hand')}</button>
        <button type="button" data-tool="pen" title="画笔 (P)，选中后再点一次选择颜色" aria-label="画笔，选中后再次点击选择颜色" aria-pressed="true" aria-expanded="false">${toolIcon('pen','#334155')}</button>
        <button type="button" data-tool="eraser" title="整笔擦除 (E)" aria-label="整笔擦除" aria-pressed="false">${icon('eraser')}</button>
        <button type="button" data-tool="select-ink" title="框选笔迹 (S)" aria-label="框选笔迹" aria-pressed="false">${icon('select-ink')}</button>
        <button type="button" data-tool="capture" title="区域截图 (C)" aria-label="区域截图" aria-pressed="false">${icon('capture')}</button>
      </div>
      <div class="qf-whiteboard-group" data-group="history">
        <button type="button" data-action="undo" title="撤销 (Ctrl / ⌘ Z)" aria-label="撤销">${icon('undo')}</button>
        <button type="button" data-action="redo" title="重做 (Ctrl / ⌘ Shift Z)" aria-label="重做">${icon('redo')}</button>
      </div>
      <div class="qf-whiteboard-group">
        <button type="button" data-action="settings" title="白板设置" aria-label="白板设置" aria-expanded="false">${icon('settings')}</button>
        <button type="button" data-action="fullscreen" title="进入全屏" aria-label="进入全屏" aria-pressed="false" hidden>${icon('fullscreen')}</button>
      </div>
    </div>
    <div class="qf-whiteboard-popup qf-whiteboard-palette" role="group" aria-label="笔迹颜色" hidden><input data-control="ink-color" type="hidden" value="#334155">${swatches(INK_COLORS,'ink')}</div>
    <div class="qf-whiteboard-popup qf-whiteboard-settings" role="group" aria-label="白板设置" hidden>
      <div class="qf-whiteboard-setting-head"><span>白板设置</span><button type="button" data-action="close-settings" title="关闭设置" aria-label="关闭设置">${icon('close')}</button></div>
      <label title="笔迹粗细">${icon('width')}<span class="qf-whiteboard-setting-label">粗细</span><input data-control="width" type="range" min="1" max="16" value="3" step="0.5" aria-label="笔迹粗细"><output data-control="width-value">3</output></label>
      <div class="qf-whiteboard-paper-colors"><span>纸色</span><input data-control="paper-color" type="hidden" value="#ffffff"><div role="group" aria-label="常用纸色">${swatches(PAPER_COLORS,'paper')}</div></div>
      <label title="纸张样式">${icon('grid')}<span class="qf-whiteboard-setting-label">纸面</span><select data-control="pattern" aria-label="纸张样式"><option value="plain">空白</option><option value="grid">方格</option><option value="dots">点阵</option></select></label>
      <label class="qf-whiteboard-touch" title="仅笔书写：鼠标可用，手指移动；关闭后手指也可书写">${icon('stylus')}<span class="qf-whiteboard-setting-label">仅笔书写</span><input data-control="pen-only" type="checkbox" aria-label="仅笔书写" checked></label>
      <button type="button" class="qf-whiteboard-clear" data-action="clear" title="清空本题笔迹" aria-label="清空本题笔迹">${icon('clear')}</button>
    </div>
    <div class="qf-whiteboard-selection-actions" role="group" aria-label="选中笔迹" hidden><span data-control="selection-count"></span><button type="button" data-action="copy-selection" aria-label="复制选中笔迹" title="复制一份">${icon('copy')}</button><button type="button" data-action="delete-selection" aria-label="删除选中笔迹" title="删除">${icon('clear')}</button><button type="button" data-action="cancel-selection" aria-label="取消选择" title="取消选择">${icon('close')}</button></div>
    <dialog class="qf-whiteboard-capture-preview" aria-label="区域截图预览"><div class="qf-whiteboard-capture-head"><strong>区域截图</strong><button type="button" data-action="close-capture" aria-label="关闭截图预览">${icon('close')}</button></div><img alt="选定区域的题目与草稿截图"><div class="qf-whiteboard-capture-footer"><span class="qf-whiteboard-capture-status" role="status">只截取选定区域，不包含工具栏</span><div class="qf-whiteboard-capture-actions"><button type="button" data-action="copy-capture">复制图片</button><a download>下载 PNG</a></div></div></dialog>
    <div class="qf-whiteboard-confirm" role="dialog" aria-modal="true" aria-label="清空白板" hidden>
      <div><p>清空本题的所有笔迹？清空后可以撤销。</p><button type="button" data-action="confirm-clear">清空笔迹</button><button type="button" data-action="cancel-clear">取消</button></div>
    </div>
    <div class="qf-whiteboard-status" role="status" aria-live="polite"></div>`;
  container.append(root);
  const toolbarParent = toolbarContainer || root;
  const select = selector => root.querySelector(selector) || toolbarContainer?.querySelector(selector);
  const canvas = select('canvas'), paperElement = select('.qf-whiteboard-paper');
  canvas.hidden = true;
  const context = canvas.getContext('2d');
  if (!context) { root.remove(); throw new Error('This browser does not support canvas'); }
  // Keep paper behind the question; only the transparent ink layer overlays it.
  paperElement.hidden = true;
  container.append(paperElement);
  const toolbar = select('.qf-whiteboard-toolbar'), confirmation = select('.qf-whiteboard-confirm');
  const selectionActions = select('.qf-whiteboard-selection-actions');
  const palette = select('.qf-whiteboard-palette'), settings = select('.qf-whiteboard-settings');
  toolbar.hidden = true;
  // Popups sit beside the toolbar, not inside it, so a scrolling toolbar never clips them.
  if (toolbarContainer) for (const element of [toolbar, palette, settings]) toolbarContainer.append(element);
  const popups = [palette, settings];
  const inkColor = select('[data-control="ink-color"]'), widthInput = select('[data-control="width"]');
  const widthValue = select('[data-control="width-value"]'), penOnly = select('[data-control="pen-only"]');
  const paperColor = select('[data-control="paper-color"]'), pattern = select('[data-control="pattern"]');
  const undoButton = select('[data-action="undo"]'), redoButton = select('[data-action="redo"]');
  const status = select('.qf-whiteboard-status');
  const toolButtons = [...toolbar.querySelectorAll('[data-tool]')];
  const settingsButton = select('[data-action="settings"]'), fullscreenButton = select('[data-action="fullscreen"]');
  const penButton = select('[data-tool="pen"]'), expandButton = select('.qf-whiteboard-expand');
  const capturePreview=select('.qf-whiteboard-capture-preview'), captureImage=capturePreview.querySelector('img'),captureLink=capturePreview.querySelector('a');
  const query = selector => [...root.querySelectorAll(selector), ...(toolbarContainer ? toolbarContainer.querySelectorAll(selector) : [])];
  const listeners = [];
  const listen = (target, type, listener, options) => {
    target.addEventListener(type, listener, options);
    listeners.push(() => target.removeEventListener(type, listener, options));
  };
  let mode = 'practice', tool = 'pen', destroyed = false, frame = 0, loadGeneration = 0;
  let fullscreenActive = false;
  let viewCamera = null;
  let readOnly = false, readOnlyCamera = null, writableTool = tool;
  let viewWidth = 1, viewHeight = 1, pixelRatio = 1, strokeSequence = 0;
  let gesture = null, cameraBefore = null, interaction = false, eraserCursor = null;
  let selectedIds = [], clipboard = [], capturing = false, captureGeneration = 0;
  let toolbarDrag = null, suppressClickUntil = 0, settle = null, dock = readDock(), cornerOpen = false, expandIcon = '', interactiveClip = '';
  let captureUrl=null,captureBlob=null;
  const pointers = new Map();

  function readDock() {
    try { return normalizeDock(JSON.parse(win.localStorage.getItem(TOOLBAR_STORAGE_KEY))); }
    catch { return { ...DEFAULT_TOOLBAR_DOCK }; }
  }
  function saveDock() {
    try { win.localStorage.setItem(TOOLBAR_STORAGE_KEY, JSON.stringify(dock)); } catch { /* Position is a per-device convenience. */ }
  }
  function report(message = '') { status.textContent = message; }
  function closeSettings({ focus = false } = {}) {
    settings.hidden = true;
    settingsButton.setAttribute('aria-expanded', 'false');
    if (focus) settingsButton.focus({ preventScroll: true });
  }
  function closePalette({ focus = false } = {}) {
    palette.hidden = true; penButton.setAttribute('aria-expanded','false');
    if (focus) penButton.focus({ preventScroll: true });
  }
  function nextStrokeId() { return `ink-${Date.now().toString(36)}-${(++strokeSequence).toString(36)}-${Math.random().toString(36).slice(2,8)}`; }
  function selectedStrokes() { const ids = new Set(selectedIds); return model.strokes.filter(stroke => ids.has(stroke.id)); }
  function selectionBounds() { return strokeBounds(selectedStrokes()); }
  function notifyInteraction(active) {
    if (interaction === active) return;
    interaction = active;
    onInteractionChange(active);
  }
  // History navigation has its own camera; the frozen draft never changes.
  let localCamera = model.viewport;
  function draftCamera() { return { ...(readOnly ? readOnlyCamera : localCamera) }; }
  function setDraftCamera(value) {
    const next = normalizeViewport(value), previous = draftCamera();
    if (readOnly) readOnlyCamera = next; else localCamera = next;
    return next.x !== previous.x || next.y !== previous.y || next.zoom !== previous.zoom;
  }
  function emitChange() { updateControls(); if (readOnly) onViewChange(draftCamera()); else onChange(model.getDraft()); }
  function emitViewChange() { updateControls(); onViewChange(draftCamera()); }
  function updateControls() {
    for (const button of toolButtons) button.hidden = readOnly && !READ_ONLY_TOOLS.includes(button.dataset.tool);
    undoButton.parentElement.hidden = readOnly;
    settingsButton.hidden = readOnly;
    undoButton.disabled = readOnly || !model.canUndo;
    redoButton.disabled = readOnly || !model.canRedo;
    select('[data-action="clear"]').disabled = model.strokes.length === 0;
    paperColor.value = model.paper.color;
    pattern.value = model.paper.pattern;
    for (const button of query('[data-ink]')) button.setAttribute('aria-pressed',String(button.dataset.ink === inkColor.value));
    for (const button of query('[data-paper]')) button.setAttribute('aria-pressed',String(button.dataset.paper === model.paper.color));
    const nextIcon = toolIcon(tool, inkColor.value);
    if (nextIcon !== expandIcon) {
      expandIcon = nextIcon; expandButton.innerHTML = nextIcon;
      expandButton.setAttribute('aria-label', `展开白板工具（当前：${TOOL_LABELS[tool]}）`);
    }
    selectedIds = selectedIds.filter(id => model.strokes.some(stroke => stroke.id === id));
    selectionActions.hidden = readOnly || mode !== 'draft' || tool !== 'select-ink' || !selectedIds.length || !!gesture;
    select('[data-control="selection-count"]').textContent = `${selectedIds.length} 笔 · 拖动选区可移动`;
  }
  function displayCamera() { return mode === 'practice' && viewCamera ? { ...viewCamera } : draftCamera(); }
  function syncCamera() {
    const camera = displayCamera();
    // Host content uses these same screen translations with transform-origin: 0 0.
    // Keep the question world and transparent ink overlay on one camera.
    container.style.setProperty('--qf-whiteboard-x', `${camera.x * camera.zoom}px`);
    container.style.setProperty('--qf-whiteboard-y', `${camera.y * camera.zoom}px`);
    container.style.setProperty('--qf-whiteboard-zoom', String(camera.zoom));
  }
  function scrollOffset() {
    return { x: container.scrollLeft || 0, y: container.scrollTop || 0 };
  }
  function syncScroll() {
    const scroll = scrollOffset();
    // The absolute overlay normally scrolls with content. Counter that movement
    // and repaint world ink into the visible canvas instead of clipping it above.
    root.style.transform = `translate(${scroll.x}px, ${scroll.y}px)`;
    paperElement.style.transform = root.style.transform;
  }
  function requestPaint() {
    if (!frame && !destroyed) frame = win.requestAnimationFrame(() => { frame = 0; paint(); });
  }
  // Question frames report the controls a learner can use, in frame pixels.
  // The hand tool leaves those areas to the frame and pans everywhere else.
  function interactiveRects() {
    if (mode !== 'draft' || tool !== 'hand') return [];
    const origin = canvas.getBoundingClientRect(), rects = [];
    for (const element of container.querySelectorAll('iframe')) {
      const regions = element.qfInteractiveRegions;
      if (!regions?.length) continue;
      const bounds = element.getBoundingClientRect();
      if (!bounds.width || !bounds.height) continue;
      const scaleX = bounds.width / (element.offsetWidth || bounds.width), scaleY = bounds.height / (element.offsetHeight || bounds.height);
      for (const [x, y, width, height] of regions) {
        rects.push({ x: bounds.left - origin.left + x * scaleX, y: bounds.top - origin.top + y * scaleY, width: width * scaleX, height: height * scaleY });
      }
    }
    return rects;
  }
  function syncInteractiveClip() {
    const round = value => Math.round(value * 10) / 10;
    const holes = interactiveRects().filter(rect => rect.x < viewWidth && rect.y < viewHeight && rect.x + rect.width > 0 && rect.y + rect.height > 0);
    // Regions are disjoint, so even-odd turns each one into a hole that hit testing skips.
    const next = holes.length ? `path(evenodd, "M0 0H${round(viewWidth)}V${round(viewHeight)}H0Z${holes.map(rect => `M${round(rect.x)} ${round(rect.y)}h${round(rect.width)}v${round(rect.height)}h${round(-rect.width)}Z`).join('')}")` : '';
    if (next === interactiveClip) return;
    interactiveClip = next;
    if (next) canvas.style.setProperty('clip-path', next); else canvas.style.removeProperty('clip-path');
  }
  function insideInteractiveRegion(point) {
    return interactiveRects().some(rect => point.x >= rect.x && point.y >= rect.y && point.x <= rect.x + rect.width && point.y <= rect.y + rect.height);
  }
  function strokeWidth(stroke, point) { return stroke.width * (0.35 + 0.65 * point.pressure); }
  function paintStroke(stroke) {
    const points = stroke.points;
    if (!points.length) return;
    context.strokeStyle = stroke.color;
    context.fillStyle = stroke.color;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    const dot = point => {
      context.beginPath();
      context.arc(point.x, point.y, strokeWidth(stroke, point) / 2, 0, Math.PI * 2);
      context.fill();
    };
    dot(points[0]);
    for (let i = 1; i < points.length; i++) {
      const previous = points[i - 1], current = points[i];
      const from = i === 1 ? previous : { x: (points[i - 2].x + previous.x) / 2, y: (points[i - 2].y + previous.y) / 2 };
      const to = i === points.length - 1 ? current : { x: (previous.x + current.x) / 2, y: (previous.y + current.y) / 2 };
      context.lineWidth = (strokeWidth(stroke, previous) + strokeWidth(stroke, current)) / 2;
      context.beginPath();
      context.moveTo(from.x, from.y);
      context.quadraticCurveTo(previous.x, previous.y, to.x, to.y);
      context.stroke();
    }
    if (points.length > 1) dot(points[points.length - 1]);
  }
  function paint() {
    if (destroyed) return;
    const camera = displayCamera(), scroll = scrollOffset();
    syncCamera();
    syncScroll();
    syncInteractiveClip();
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (mode === 'practice') return;
    context.setTransform(pixelRatio * camera.zoom, 0, 0, pixelRatio * camera.zoom,
      pixelRatio * (camera.x * camera.zoom - scroll.x), pixelRatio * (camera.y * camera.zoom - scroll.y));
    for (const stroke of model.strokes) {
      if (gesture?.kind === 'erase' && gesture.erasedIds.has(stroke.id)) continue;
      const preview = gesture?.kind === 'move-selection' && selectedIds.includes(stroke.id) ? translateStrokes([stroke],selectedIds,gesture.dx,gesture.dy)[0] : stroke;
      paintStroke(preview);
    }
    if (gesture?.kind === 'ink') paintStroke(gesture.stroke);
    if (mode === 'draft') {
      let rect = gesture?.kind === 'box' ? rectangle(gesture.from,gesture.to) : tool === 'select-ink' ? selectionBounds() : null;
      if (rect && gesture?.kind === 'move-selection') rect = {...rect,x:rect.x+gesture.dx,y:rect.y+gesture.dy};
      if (rect) { context.strokeStyle='#8661ca'; context.fillStyle='#8661ca16'; context.lineWidth=1/draftCamera().zoom; context.setLineDash([5/draftCamera().zoom,4/draftCamera().zoom]); context.fillRect(rect.x,rect.y,rect.width,rect.height); context.strokeRect(rect.x,rect.y,rect.width,rect.height); context.setLineDash([]); }
      if (gesture?.kind === 'capture') { const rect = rectangle(gesture.from,gesture.to); context.setTransform(pixelRatio,0,0,pixelRatio,0,0); context.strokeStyle='#8661ca'; context.fillStyle='#8661ca16'; context.setLineDash([5,4]); context.lineWidth=1; context.fillRect(rect.x,rect.y,rect.width,rect.height); context.strokeRect(rect.x,rect.y,rect.width,rect.height); context.setLineDash([]); }
    }
    if (mode === 'draft' && eraserCursor && tool === 'eraser') {
      context.strokeStyle = '#64748b';
      context.lineWidth = 1 / camera.zoom;
      context.beginPath();
      context.arc(eraserCursor.x, eraserCursor.y, eraserRadius(), 0, Math.PI * 2);
      context.stroke();
    }
    paperElement.dataset.pattern = model.paper.pattern;
    paperElement.style.backgroundColor = model.paper.color;
    paperElement.style.backgroundSize = `${24 * camera.zoom}px ${24 * camera.zoom}px`;
    paperElement.style.backgroundPosition = `${camera.x * camera.zoom - scroll.x}px ${camera.y * camera.zoom - scroll.y}px`;
    updateControls();
  }
  function resize() {
    syncScroll();
    const bounds = root.getBoundingClientRect();
    viewWidth = Math.max(1, root.clientWidth || bounds.width);
    viewHeight = Math.max(1, root.clientHeight || bounds.height);
    pixelRatio = Math.min(3, win.devicePixelRatio || 1);
    const width = Math.round(viewWidth * pixelRatio), height = Math.round(viewHeight * pixelRatio);
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    requestPaint();
    layoutToolbar();
  }
  function toolbarArea() {
    const bounds = toolbarParent.getBoundingClientRect();
    return { left: bounds.left, top: bounds.top, width: toolbarParent.clientWidth || bounds.width, height: toolbarParent.clientHeight || bounds.height };
  }
  function relativeBox(element, area = toolbarArea()) {
    const bounds = element.getBoundingClientRect();
    return { left: bounds.left - area.left, top: bounds.top - area.top, width: bounds.width, height: bounds.height };
  }
  // The toolbar rests at one of eight fixed stops: an open bar in the middle of
  // an edge, or a ball in a corner that opens along its edge when tapped.
  function layoutToolbar() {
    if (toolbarDrag?.moved) return;
    const layout = anchorLayout(dock.anchor, cornerOpen);
    toolbar.dataset.side = layout.side;
    toolbar.dataset.anchor = dock.anchor;
    toolbar.dataset.collapsed = String(layout.collapsed);
    toolbar.setAttribute('aria-orientation', layout.vertical ? 'vertical' : 'horizontal');
    expandButton.hidden = !layout.collapsed;
    expandButton.setAttribute('aria-expanded', String(!layout.collapsed));
    if (layout.collapsed) { closeSettings(); closePalette(); }
    if (toolbar.hidden) return;
    // Offset sizes ignore any transform still settling from the last move.
    const area = toolbarArea(), rect = relativeBox(toolbar, area);
    const box = { width: toolbar.offsetWidth || rect.width, height: toolbar.offsetHeight || rect.height };
    const obstacles = [...toolbarObstacles()].map(element => relativeBox(element, area)).filter(item => item.width && item.height);
    const position = dockedPosition(dock, { width: area.width, height: area.height }, { width: box.width, height: box.height }, obstacles, { open: cornerOpen });
    toolbar.style.left = `${position.left}px`; toolbar.style.top = `${position.top}px`;
    positionPopups();
  }
  function positionPopups() {
    const area = toolbarArea(), bar = relativeBox(toolbar, area);
    for (const [popup, anchor] of [[palette, penButton], [settings, settingsButton]]) {
      if (popup.hidden) continue;
      const own = relativeBox(popup, area);
      const position = popupPosition(anchorLayout(dock.anchor, cornerOpen).side, { width: area.width, height: area.height }, bar, relativeBox(anchor, area), { width: own.width, height: own.height });
      popup.style.left = `${position.left}px`; popup.style.top = `${position.top}px`;
    }
  }
  function prefersReducedMotion() { return !!win.matchMedia?.('(prefers-reduced-motion: reduce)').matches; }
  function toolbarBox() {
    const rect = toolbar.offsetWidth ? null : toolbar.getBoundingClientRect();
    return { left: parseFloat(toolbar.style.left) || 0, top: parseFloat(toolbar.style.top) || 0, width: toolbar.offsetWidth || rect.width, height: toolbar.offsetHeight || rect.height };
  }
  function toolbarTransform(x, y, sx = 1, sy = 1) { return `translate3d(${x}px, ${y}px, 0) scale(${sx}, ${sy})`; }
  function stopSettle() {
    if (settle) win.cancelAnimationFrame(settle.frame);
    settle = null;
    delete toolbar.dataset.settling;
    toolbar.style.removeProperty('transform');
  }
  // FLIP: the toolbar is already laid out at its new place; spring it there
  // from where it was on screen, growing from the old size.
  function settleFrom(from) {
    stopSettle();
    const to = toolbarBox();
    if (prefersReducedMotion() || !from || !to.width || !to.height || toolbar.hidden) { positionPopups(); return; }
    const channels = {
      x: { value: from.left + from.width / 2 - (to.left + to.width / 2), velocity: from.velocity?.x || 0 },
      y: { value: from.top + from.height / 2 - (to.top + to.height / 2), velocity: from.velocity?.y || 0 },
      // Scale is tracked in hundredths so it shares the spring's settle precision.
      sx: { value: (from.width / to.width - 1) * 100, velocity: 0 },
      sy: { value: (from.height / to.height - 1) * 100, velocity: 0 },
    };
    const write = () => { toolbar.style.transform = toolbarTransform(channels.x.value, channels.y.value, 1 + channels.sx.value / 100, 1 + channels.sy.value / 100); };
    toolbar.dataset.settling = 'true';
    settle = { time: null, frame: 0 };
    const step = time => {
      if (!settle) return;
      if (typeof time !== 'number') time = (settle.time ?? 0) + 16;
      const elapsed = settle.time === null ? 16 : time - settle.time;
      settle.time = time;
      let done = true;
      for (const key of Object.keys(channels)) { channels[key] = springStep(channels[key], elapsed, key.startsWith('s') ? TOOLBAR_SHAPE_SPRING : TOOLBAR_SPRING); done = done && springSettled(channels[key]); }
      if (done) { stopSettle(); positionPopups(); return; }
      write();
      settle.frame = win.requestAnimationFrame(step);
    };
    write();
    settle.frame = win.requestAnimationFrame(step);
  }
  function setDock(next, from = toolbar.hidden ? null : toolbarBox()) {
    dock = normalizeDock(next);
    cornerOpen = false;
    saveDock();
    layoutToolbar();
    settleFrom(from);
  }
  // A corner ball opens for a quick choice and folds back afterwards.
  function setCornerOpen(open) {
    if (!isCornerAnchor(dock.anchor) || cornerOpen === open) return;
    const from = toolbar.hidden ? null : toolbarBox();
    cornerOpen = open;
    layoutToolbar();
    settleFrom(from);
  }
  function stopToolbarDrag() {
    const drag = toolbarDrag; toolbarDrag = null;
    if (!drag) return null;
    if (drag.frame) win.cancelAnimationFrame(drag.frame);
    delete toolbar.dataset.dragging;
    delete toolbar.dataset.shrinking;
    toolbar.style.removeProperty('transform');
    try { toolbar.releasePointerCapture(drag.id); } catch {}
    try { drag.target.releasePointerCapture(drag.id); } catch {}
    return drag;
  }
  function startToolbarDrag(event) {
    if (event.button !== 0 || !confirmation.hidden || toolbarDrag) return;
    // Any part of the toolbar can be dragged. Until the pointer moves past the
    // threshold the press belongs to the button under it, so a tap still clicks it.
    const target = event.target?.closest?.('button') || toolbar;
    toolbarDrag = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false, samples: [], frame: 0, target };
    // Holding the pointer from the start keeps a quick first move off a small button.
    try { target.setPointerCapture(event.pointerId); } catch {}
  }
  function now() { return win.performance?.now?.() ?? Date.now(); }
  // How far the bar-to-ball shrink has got, eased; 1 when it is finished.
  function shrinkProgress(drag) {
    if (!drag.shrink) return 1;
    const linear = Math.min(1, (now() - drag.shrink.start) / TOOLBAR_SHRINK_MS);
    return 1 - (1 - linear) ** 3;
  }
  // The ball as drawn: it starts as the bar and shrinks into place around the
  // finger, so the drag starts without a jump.
  function ballVisual(drag) {
    const eased = shrinkProgress(drag), rest = 1 - eased, shrink = drag.shrink || { dx: 0, dy: 0, sx: 1, sy: 1 };
    const offset = drag.offset || { x: 0, y: 0 };
    return {
      x: offset.x + shrink.dx * rest, y: offset.y + shrink.dy * rest,
      sx: 1 + (shrink.sx - 1) * rest, sy: 1 + (shrink.sy - 1) * rest, done: eased >= 1,
    };
  }
  // Pointer moves only record input; one frame per display refresh writes a
  // transform, so dragging never lays out the page or repaints the whiteboard.
  function applyDragFrame() {
    const drag = toolbarDrag;
    if (!drag?.moved) return;
    drag.frame = 0;
    drag.offset = {
      x: Math.max(drag.bounds.minX, Math.min(drag.bounds.maxX, drag.pointer.x - drag.x)),
      y: Math.max(drag.bounds.minY, Math.min(drag.bounds.maxY, drag.pointer.y - drag.y)),
    };
    const visual = ballVisual(drag);
    toolbar.style.transform = toolbarTransform(visual.x, visual.y, visual.sx, visual.sy);
    if (!visual.done) drag.frame = win.requestAnimationFrame(applyDragFrame);
    else if (drag.shrink) { drag.shrink = null; delete toolbar.dataset.shrinking; }
  }
  function beginBallDrag(drag) {
    const from = toolbarBox();
    stopSettle();
    closeSettings(); closePalette();
    // Capture on the toolbar itself: the pressed button disappears inside the
    // ball, and moves over the question frame must keep arriving here. The
    // button loses the press, so it is not clicked.
    if (drag.target !== toolbar) try { drag.target.releasePointerCapture(drag.id); } catch {}
    try { toolbar.setPointerCapture(drag.id); } catch {}
    drag.moved = true;
    drag.previous = { ...dock };
    drag.area = toolbarArea();
    expandButton.hidden = false;
    toolbar.dataset.dragging = 'true';
    // One layout read at the start: the ball is centred under the finger and stays in the pane.
    const width = toolbar.offsetWidth || 44, height = toolbar.offsetHeight || 44;
    const left = drag.x - drag.area.left - width / 2, top = drag.y - drag.area.top - height / 2;
    toolbar.style.left = `${left}px`; toolbar.style.top = `${top}px`;
    drag.ball = { left, top, width, height };
    drag.bounds = { minX: -left, minY: -top, maxX: drag.area.width - width - left, maxY: drag.area.height - height - top };
    // FLIP: draw the ball over the bar first, then let it shrink with transform only.
    if (!prefersReducedMotion() && from.width && from.height) {
      toolbar.dataset.shrinking = 'true';
      drag.shrink = {
        start: now(),
        dx: from.left + from.width / 2 - (left + width / 2), dy: from.top + from.height / 2 - (top + height / 2),
        sx: from.width / width, sy: from.height / height,
      };
    }
  }
  function moveToolbarDrag(event) {
    const drag = toolbarDrag;
    if (drag?.id !== event.pointerId) return;
    drag.pointer = { x: event.clientX, y: event.clientY };
    drag.samples.push({ x: event.clientX, y: event.clientY, t: event.timeStamp || Date.now() });
    if (drag.samples.length > 12) drag.samples.shift();
    if (!drag.moved && !isToolbarDrag(event.clientX - drag.x, event.clientY - drag.y)) return;
    event.preventDefault();
    if (!drag.moved) beginBallDrag(drag);
    if (!drag.frame) drag.frame = win.requestAnimationFrame(applyDragFrame);
  }
  function ballBox(drag) {
    const visual = ballVisual(drag), width = drag.ball.width * visual.sx, height = drag.ball.height * visual.sy;
    return {
      left: drag.ball.left + visual.x + (drag.ball.width - width) / 2, top: drag.ball.top + visual.y + (drag.ball.height - height) / 2,
      width, height,
    };
  }
  function endToolbarDrag(event) {
    if (toolbarDrag?.id !== event.pointerId) return;
    if (toolbarDrag.moved) {
      toolbarDrag.pointer = { x: event.clientX, y: event.clientY };
      toolbarDrag.offset = {
        x: Math.max(toolbarDrag.bounds.minX, Math.min(toolbarDrag.bounds.maxX, toolbarDrag.pointer.x - toolbarDrag.x)),
        y: Math.max(toolbarDrag.bounds.minY, Math.min(toolbarDrag.bounds.maxY, toolbarDrag.pointer.y - toolbarDrag.y)),
      };
    }
    // Read the drawn ball before the drag state is cleared.
    const from = toolbarDrag.moved ? ballBox(toolbarDrag) : null;
    const drag = stopToolbarDrag();
    if (!drag.moved) return;
    // Any click that follows a drag belongs to the drag, not to a button.
    suppressClickUntil = Date.now() + 400;
    const velocity = releaseVelocity(drag.samples), ball = drag.ball;
    const centre = { x: ball.left + drag.offset.x + ball.width / 2, y: ball.top + drag.offset.y + ball.height / 2 };
    // The spring keeps the throw's momentum (px/ms to px/s).
    setDock(releaseDock(centre, velocity, { width: drag.area.width, height: drag.area.height }), { ...from, velocity: { x: velocity.x * 1000, y: velocity.y * 1000 } });
  }
  function cancelToolbarDrag(event) {
    if (toolbarDrag?.id !== event.pointerId) return;
    const from = toolbarDrag.moved ? ballBox(toolbarDrag) : null;
    const drag = stopToolbarDrag();
    if (!drag.moved) return;
    // An interrupted drag returns to where the toolbar was docked.
    dock = drag.previous;
    cornerOpen = false;
    layoutToolbar();
    settleFrom(from);
  }
  async function exportRegion(value) {
    const x=Math.max(0,Math.min(viewWidth,value.x)),y=Math.max(0,Math.min(viewHeight,value.y));
    const rect={x,y,width:Math.max(0,Math.min(viewWidth,value.x+value.width)-x),height:Math.max(0,Math.min(viewHeight,value.y+value.height)-y)};
    if (rect.width<4||rect.height<4) { report('截图范围太小，请拖出一个矩形区域。');return; }
    const generation=captureGeneration;capturing=true;report('正在生成区域截图…');
    try {
      const ink=doc.createElement('canvas');ink.width=canvas.width;ink.height=canvas.height;
      paint();ink.getContext('2d').drawImage(canvas,0,0);
      const result=onCapture ? await onCapture({rect,ink,draft:model.getDraft(),camera:draftCamera(),scroll:scrollOffset(),pixelRatio}) : null;
      if (!result) throw new Error('当前页面暂不支持区域截图。');
      if (destroyed||generation!==captureGeneration) return;
      if(captureUrl)win.URL.revokeObjectURL(captureUrl);captureBlob=result;select('[data-action="copy-capture"]').disabled=false;select('.qf-whiteboard-capture-status').textContent='只截取选定区域，不包含工具栏';captureUrl=win.URL.createObjectURL(result);captureImage.src=captureUrl;captureLink.href=captureUrl;captureLink.download=`QuizForge-草稿-${Date.now()}.png`;capturePreview.showModal();
      report('区域截图已生成，可预览并下载。');
    } catch(error){if(!destroyed&&generation===captureGeneration)report(error.message||'截图失败，请重试。');}
    finally{capturing=false;}
  }
  function screenPoint(event) {
    syncScroll(); // Programmatic scrolling may precede its deferred scroll event.
    const bounds = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - bounds.left) * viewWidth / (bounds.width || viewWidth),
      y: (event.clientY - bounds.top) * viewHeight / (bounds.height || viewHeight),
    };
  }
  function cameraPoint(point) {
    const scroll = scrollOffset();
    return { x: point.x + scroll.x, y: point.y + scroll.y };
  }
  function inkPoint(event) {
    const point = screenToWorld(cameraPoint(screenPoint(event)), draftCamera());
    const bound = value => Math.round(Math.max(-DRAFT_LIMITS.coordinate, Math.min(DRAFT_LIMITS.coordinate, value)) * 1_000) / 1_000;
    const pressure = event.pointerType === 'pen' && event.pressure > 0 ? Math.min(1, event.pressure) : 0.5;
    return { x: bound(point.x), y: bound(point.y), pressure: Math.round(pressure * 1_000) / 1_000 };
  }
  function eraserRadius() { return Math.max(8, Number(widthInput.value) * 2) / draftCamera().zoom; }
  function capture(event) { try { canvas.setPointerCapture(event.pointerId); } catch { /* A cancelled pointer may already have disappeared. */ } }
  function releaseAll() {
    const ids = [...pointers.keys()];
    pointers.clear();
    for (const id of ids) { try { if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id); } catch {} }
  }
  function cancelInteraction() {
    gesture = null;
    if (cameraBefore) setDraftCamera(cameraBefore);
    cameraBefore = null;
    releaseAll();
    eraserCursor = null;
    syncCamera();
    notifyInteraction(false);
    requestPaint();
  }
  function finishInteraction(commit = true) {
    if (!interaction) return;
    const active = gesture;
    gesture = null;
    let changed = false;
    if (commit) {
      try {
        if (!readOnly && active?.kind === 'ink' && active.stroke.points.length) changed = model.appendStroke(active.stroke);
        else if (!readOnly && active?.kind === 'erase') changed = model.eraseAlong(active.points, active.radius);
        else if (!readOnly && active?.kind === 'box') { selectedIds = enclosedStrokes(model.strokes,rectangle(active.from,active.to)); if (!selectedIds.length) report('框内没有完整笔迹，请扩大选区。'); }
        else if (!readOnly && active?.kind === 'move-selection') changed = model.editStrokes(translateStrokes(model.strokes,selectedIds,active.dx,active.dy));
        else if (active?.kind === 'capture') exportRegion(rectangle(active.from,active.to));
        const camera = draftCamera();
        changed ||= !!cameraBefore && (camera.x !== cameraBefore.x || camera.y !== cameraBefore.y || camera.zoom !== cameraBefore.zoom);
      } catch (error) { report(error.message); }
    } else if (cameraBefore) setDraftCamera(cameraBefore);
    cameraBefore = null;
    releaseAll();
    syncCamera();
    if (changed) { if (['pan','pinch'].includes(active?.kind)) emitViewChange(); else emitChange(); }
    notifyInteraction(false);
    requestPaint();
  }
  function startPinch() {
    const touches = [...pointers.entries()].filter(([, pointer]) => pointer.type === 'touch');
    if (touches.length < 2) return;
    const [first, second] = touches;
    const midpoint = { x: (first[1].screen.x + second[1].screen.x) / 2, y: (first[1].screen.y + second[1].screen.y) / 2 };
    gesture = {
      kind: 'pinch', ids: [first[0], second[0]], camera: draftCamera(),
      anchor: screenToWorld(cameraPoint(midpoint), draftCamera()),
      distance: Math.max(1, Math.hypot(first[1].screen.x - second[1].screen.x, first[1].screen.y - second[1].screen.y)),
    };
    requestPaint(); // Discard any first-finger preview immediately.
  }
  function beginPan(pointerId, screen) { gesture = { kind: 'pan', pointerId, origin: screen, camera: draftCamera() }; }
  function previewErase(path) {
    for (const stroke of model.strokes) {
      if (!gesture.erasedIds.has(stroke.id) && strokeTouchesPath(stroke, path, gesture.radius)) gesture.erasedIds.add(stroke.id);
    }
  }
  function pointerDown(event) {
    if (mode !== 'draft' || capturing || !confirmation.hidden || (event.pointerType === 'mouse' && ![0, 1, 2].includes(event.button))) return;
    const screen = screenPoint(event);
    // Browsers that ignore clip-path hit testing still leave question controls alone.
    if (tool === 'hand' && !gesture && insideInteractiveRegion(screen)) return;
    event.preventDefault();
    // A resting palm cannot replace an active stylus gesture.
    if (event.pointerType === 'touch' && gesture?.pointerType === 'pen') return;
    if (event.pointerType === 'pen' && gesture && gesture.pointerType !== 'pen') cancelInteraction();
    pointers.set(event.pointerId, { type: event.pointerType, screen });
    capture(event);
    if (!interaction) { cameraBefore = draftCamera(); notifyInteraction(true); report(); }
    if (event.pointerType === 'touch' && [...pointers.values()].filter(pointer => pointer.type === 'touch').length >= 2) {
      startPinch();
      return;
    }
    if (gesture) return;
    const selectedTool = event.pointerType === 'mouse' && event.button !== 0 ? 'hand' : tool;
    if (selectedTool === 'capture') { selectedIds=[]; gesture={kind:'capture',pointerId:event.pointerId,pointerType:event.pointerType,from:screen,to:screen}; }
    else if (selectedTool === 'select-ink' && !readOnly) {
      const point = inkPoint(event);
      if (containsPoint(selectionBounds(),point)) gesture={kind:'move-selection',pointerId:event.pointerId,pointerType:event.pointerType,from:point,dx:0,dy:0};
      else { selectedIds=[]; gesture={kind:'box',pointerId:event.pointerId,pointerType:event.pointerType,from:point,to:point}; }
    }
    else if (selectedTool === 'hand' || (event.pointerType === 'touch' && penOnly.checked)) beginPan(event.pointerId, screen);
    else if (selectedTool === 'eraser') {
      gesture = { kind: 'erase', pointerId: event.pointerId, pointerType: event.pointerType, radius: eraserRadius(), points: [inkPoint(event)], erasedIds: new Set() };
      previewErase(gesture.points);
    } else {
      selectedIds=[]; const id = nextStrokeId();
      gesture = { kind: 'ink', pointerId: event.pointerId, pointerType: event.pointerType,
        stroke: { id, color: inkColor.value, width: Number(widthInput.value), points: [inkPoint(event)] } };
    }
    canvas.focus({ preventScroll: true });
    requestPaint();
  }
  function addSamples(event) {
    const points = gesture.kind === 'ink' ? gesture.stroke.points : gesture.points;
    const samples = typeof event.getCoalescedEvents === 'function' ? event.getCoalescedEvents() : [];
    for (const sample of samples.length ? samples : [event]) {
      if (points.length >= DRAFT_LIMITS.maxPointsPerStroke) break;
      const point = inkPoint(sample), previous = points[points.length - 1];
      if (!previous || Math.hypot(point.x - previous.x, point.y - previous.y) * draftCamera().zoom >= 0.35) {
        points.push(point);
        if (gesture.kind === 'erase') previewErase(previous ? [previous, point] : [point]);
      }
    }
  }
  function pointerMove(event) {
    if (mode !== 'draft') return;
    eraserCursor = inkPoint(event);
    const pointer = pointers.get(event.pointerId);
    if (!pointer) { if (tool === 'eraser') requestPaint(); return; }
    event.preventDefault();
    pointer.screen = screenPoint(event);
    if (gesture?.kind === 'pinch') {
      const [first, second] = gesture.ids.map(id => pointers.get(id));
      if (!first || !second) return;
      const midpoint = { x: (first.screen.x + second.screen.x) / 2, y: (first.screen.y + second.screen.y) / 2 };
      const distance = Math.hypot(first.screen.x - second.screen.x, first.screen.y - second.screen.y);
      const zoom = Math.max(DRAFT_LIMITS.minZoom, Math.min(DRAFT_LIMITS.maxZoom, gesture.camera.zoom * distance / gesture.distance));
      const bound = value => Math.max(-DRAFT_LIMITS.coordinate, Math.min(DRAFT_LIMITS.coordinate, value));
      const anchor = cameraPoint(midpoint);
      setDraftCamera({ x: bound(anchor.x / zoom - gesture.anchor.x), y: bound(anchor.y / zoom - gesture.anchor.y), zoom });
    } else if (gesture?.pointerId === event.pointerId) {
      if (gesture.kind === 'pan') setDraftCamera(translateCamera(gesture.camera, pointer.screen.x - gesture.origin.x, pointer.screen.y - gesture.origin.y));
      else if (gesture.kind === 'box') gesture.to=inkPoint(event);
      else if (gesture.kind === 'capture') gesture.to=pointer.screen;
      else if (gesture.kind === 'move-selection') { const point=inkPoint(event);gesture.dx=point.x-gesture.from.x;gesture.dy=point.y-gesture.from.y; }
      else addSamples(event);
    }
    syncCamera();
    requestPaint();
  }
  function pointerUp(event) {
    if (!pointers.has(event.pointerId)) return;
    event.preventDefault();
    pointerMove(event); // Include the final position even if the browser omitted a last move.
    pointers.delete(event.pointerId);
    if (gesture?.kind === 'pinch') {
      const touches = [...pointers.entries()].filter(([, pointer]) => pointer.type === 'touch');
      if (touches.length >= 2) startPinch();
      else if (touches.length === 1) beginPan(touches[0][0], touches[0][1].screen);
      else finishInteraction();
    } else if (gesture?.pointerId === event.pointerId) finishInteraction();
    try { if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId); } catch {}
  }
  function setTool(value) {
    const next = TOOL_ALIASES[value] || value;
    if (!TOOL_LABELS[next] || (readOnly && !READ_ONLY_TOOLS.includes(next))) return;
    finishInteraction();
    tool = next;
    if (tool !== 'select-ink') selectedIds=[];
    closeSettings();closePalette();report(tool==='capture'?'从一个角拖到对角，松开即可截取区域。':tool==='select-ink'?'拖出矩形框选完整笔迹；拖动选区可移动。':'');
    root.dataset.tool = tool;
    toolButtons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.tool === tool)));
    canvas.tabIndex = mode === 'draft' ? 0 : -1;
    eraserCursor = null;
    updateControls();
    requestPaint();
  }
  function chooseTool(next) {
    // Pressing the active pen again opens its colors, like an annotation toolbar.
    if (next === 'pen' && tool === 'pen' && !readOnly) {
      const open = palette.hidden;
      closeSettings();
      palette.hidden = !open; penButton.setAttribute('aria-expanded', String(open));
      positionPopups();
      if (open) palette.querySelector('[aria-pressed="true"]')?.focus({ preventScroll: true });
      return;
    }
    setTool(next);
  }
  function toolShortcut(event) {
    const next = { v: 'hand', h: 'hand', p: 'pen', e: 'eraser', s:'select-ink',c:'capture' }[event.key.toLowerCase()];
    if (mode === 'draft' && confirmation.hidden && !event.ctrlKey && !event.metaKey && !event.altKey && next) {
      event.preventDefault();
      setTool(next);
    }
  }
  function focusTool() { canvas.focus({ preventScroll: true }); }
  function perform(action) {
    if (readOnly && !['fullscreen', 'expand-toolbar'].includes(action)) return;
    finishInteraction();
    report();
    let changed = false;
    if (action === 'settings') {
      closePalette();
      settings.hidden = !settings.hidden;
      settingsButton.setAttribute('aria-expanded', String(!settings.hidden));
      positionPopups();
      if (!settings.hidden) widthInput.focus({ preventScroll: true });
    }
    else if (action === 'close-settings') closeSettings({ focus: true });
    else if (action === 'expand-toolbar') { setCornerOpen(true); toolbar.querySelector(`[data-tool="${tool}"]`)?.focus({ preventScroll: true }); }
    else if (action === 'cancel-selection') selectedIds=[];
    else if (action === 'delete-selection' && selectedIds.length) { changed=model.editStrokes(model.strokes.filter(stroke=>!selectedIds.includes(stroke.id)));selectedIds=[]; }
    else if (action === 'copy-selection' && selectedIds.length) {
      try { const copies=translateStrokes(model.strokes,selectedIds,24/draftCamera().zoom,24/draftCamera().zoom,nextStrokeId);changed=model.editStrokes([...model.strokes,...copies]);selectedIds=copies.map(stroke=>stroke.id); } catch(error){report(error.message);}
    }
    else if (action === 'undo') { selectedIds=[];changed = model.undo(); }
    else if (action === 'redo') { selectedIds=[];changed = model.redo(); }
    else if (action === 'clear' && model.strokes.length) { closeSettings(); confirmation.hidden = false; select('[data-action="cancel-clear"]').focus(); }
    else if (action === 'cancel-clear') { confirmation.hidden = true; focusTool(); }
    else if (action === 'confirm-clear') { changed = model.clear(); confirmation.hidden = true; focusTool(); }
    else if (action === 'fullscreen' && mode === 'draft') { closeSettings(); onFullscreen(); }
    toolbar.inert = !confirmation.hidden;
    if (changed) emitChange();
    syncCamera();
    requestPaint();
  }
  function controlClick(event, scope) {
    if (!confirmation.hidden) return;
    // A click that a drag produced must not switch tools, open a panel or collapse.
    if (scope === toolbar && Date.now() < suppressClickUntil) { suppressClickUntil = 0; return; }
    const button = event.target.closest('button');
    if (!button || !scope.contains(button)) return;
    if (button.dataset.ink && !readOnly) { inkColor.value=button.dataset.ink;closePalette({focus:true});setCornerOpen(false);updateControls();penButton.querySelector('.qf-whiteboard-pen-color')?.style.setProperty('--swatch',inkColor.value); }
    else if (button.dataset.paper && !readOnly) { finishInteraction();if(model.setPaper({color:button.dataset.paper,pattern:pattern.value}))emitChange();requestPaint(); }
    else if (button.dataset.tool) { chooseTool(button.dataset.tool); if (palette.hidden) setCornerOpen(false); }
    else if (button.dataset.action) perform(button.dataset.action);
  }
  listen(canvas, 'pointerdown', pointerDown);
  listen(canvas, 'pointermove', pointerMove);
  listen(canvas, 'pointerup', pointerUp);
  listen(canvas, 'pointercancel', event => { if (pointers.has(event.pointerId)) cancelInteraction(); });
  listen(canvas, 'lostpointercapture', event => { if (pointers.has(event.pointerId)) cancelInteraction(); });
  listen(canvas, 'pointerleave', () => { eraserCursor = null; requestPaint(); });
  listen(canvas, 'contextmenu', event => { if (mode === 'draft') event.preventDefault(); });
  listen(canvas, 'wheel', event => {
    if (mode !== 'draft') return;
    event.preventDefault();
    finishInteraction();
    const amount = Math.max(-100, Math.min(100, event.deltaY));
    const camera = draftCamera();
    if (setDraftCamera(zoomAt(camera, camera.zoom * Math.exp(-amount * 0.002), cameraPoint(screenPoint(event))))) emitViewChange();
    syncCamera();
    requestPaint();
  }, { passive: false });
  for (const scope of [toolbar, ...popups]) listen(scope, 'click', event => controlClick(event, scope));
  listen(selectionActions,'click',event=>{const button=event.target.closest('button');if(button&&selectionActions.contains(button)&&confirmation.hidden)perform(button.dataset.action);});
  listen(toolbar, 'pointerdown', startToolbarDrag);
  // Before the threshold the pressed button holds the capture; afterwards the
  // toolbar does, because the button is hidden inside the ball. Both reach these listeners.
  listen(toolbar, 'pointermove', moveToolbarDrag);
  listen(toolbar, 'pointerup', endToolbarDrag);
  listen(toolbar, 'pointercancel', cancelToolbarDrag);
  listen(toolbar, 'lostpointercapture', event => { if (event.target === toolbar && toolbarDrag?.moved) cancelToolbarDrag(event); });
  // Alt + arrow keys move the toolbar to the next stop, from any of its buttons.
  listen(toolbar, 'keydown', event => {
    const step = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
    if (!step || !event.altKey || event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    const focused = doc.activeElement;
    setDock({ anchor: stepAnchor(dock.anchor, ...step) });
    if (focused?.hidden || !toolbar.contains(focused)) (expandButton.hidden ? toolbar.querySelector('button:not([hidden])') : expandButton)?.focus({ preventScroll: true });
  });
  listen(select('[data-action="copy-capture"]'),'click',async event=>{
    const blob=captureBlob;if(!blob||event.target.disabled)return;
    const button=select('[data-action="copy-capture"]'),status=select('.qf-whiteboard-capture-status');button.disabled=true;
    try{await copyCaptureImage(blob,win);if(captureBlob===blob)status.textContent='图片已复制，可直接粘贴。';}
    catch(error){if(captureBlob===blob)status.textContent=error.message;}
    finally{if(captureBlob===blob&&!destroyed)button.disabled=false;}
  });
  listen(select('[data-action="close-capture"]'),'click',()=>capturePreview.close());
  listen(capturePreview,'close',()=>{captureBlob=null;if(captureUrl){win.URL.revokeObjectURL(captureUrl);captureUrl=null;}captureImage.removeAttribute('src');captureLink.removeAttribute('href');});
  listen(confirmation, 'click', event => {
    const button = event.target.closest('button');
    if (button && confirmation.contains(button)) perform(button.dataset.action);
  });
  listen(widthInput, 'input', () => { widthValue.value = widthInput.value; widthValue.textContent = widthInput.value; });
  listen(penOnly, 'change', cancelInteraction);
  for (const control of [paperColor, pattern]) listen(control, 'change', () => {
    if (readOnly) { updateControls(); return; }
    finishInteraction();
    if (model.setPaper({ color: paperColor.value, pattern: pattern.value })) emitChange();
    requestPaint();
  });
  listen(root, 'keydown', event => {
    if (mode !== 'draft') return;
    if (event.key === 'Escape') { if (!fullscreenActive) event.preventDefault(); cancelInteraction(); selectedIds=[];confirmation.hidden = true; toolbar.inert = false; closeSettings();closePalette(); return; }
    if (event.target !== canvas) return;
    const key = event.key.toLowerCase();
    if ((event.ctrlKey || event.metaKey) && ['z', 'y'].includes(key)) {
      event.preventDefault(); perform(key === 'y' || event.shiftKey ? 'redo' : 'undo');
    } else if (!readOnly&&tool==='select-ink'&&['Delete','Backspace'].includes(event.key)) { event.preventDefault();perform('delete-selection'); }
    else if (!readOnly&&tool==='select-ink'&&(event.ctrlKey||event.metaKey)&&key==='c') { event.preventDefault();clipboard=structuredClone(selectedStrokes());report(`已复制 ${clipboard.length} 笔，按 Ctrl / ⌘ V 粘贴。`); }
    else if (!readOnly&&tool==='select-ink'&&(event.ctrlKey||event.metaKey)&&key==='v'&&clipboard.length) { event.preventDefault();try{const copies=translateStrokes(clipboard,clipboard.map(stroke=>stroke.id),24/draftCamera().zoom,24/draftCamera().zoom,nextStrokeId);if(model.editStrokes([...model.strokes,...copies])){selectedIds=copies.map(stroke=>stroke.id);emitChange();requestPaint();}}catch(error){report(error.message);} }
    else toolShortcut(event);
  });
  for (const scope of [toolbar, ...popups]) listen(scope, 'keydown', event => {
    if (event.key === 'Escape') {
      if (!fullscreenActive) event.preventDefault();
      if (!settings.hidden) closeSettings({focus:true});
      if (!palette.hidden) closePalette({focus:true});
    }
    if (event.target.closest('button')?.dataset.tool) toolShortcut(event);
  });
  listen(win, 'pointerdown', event => { if (![toolbar, ...popups].some(scope => scope.contains(event.target))) {closeSettings();closePalette();setCornerOpen(false);} });
  listen(win, 'blur', () => {cancelInteraction();if(toolbarDrag)cancelToolbarDrag({pointerId:toolbarDrag.id});});
  listen(container, 'scroll', () => { syncScroll(); requestPaint(); onScroll(); }, { passive: true });
  listen(container, 'qf-interactive-regions', requestPaint);
  const observer = win.ResizeObserver ? new win.ResizeObserver(resize) : null;
  if (observer) observer.observe(container);
  else listen(win, 'resize', resize);
  root.dataset.tool = tool;
  syncCamera();
  resize();
  updateControls();

  return {
    setReadOnly(value) {
      if (destroyed || readOnly === !!value) return;
      cancelInteraction();
      selectedIds=[];closePalette();
      if (value) writableTool = tool;
      readOnly = !!value;
      readOnlyCamera = readOnly ? model.viewport : null;
      setTool(readOnly ? 'hand' : writableTool);
      confirmation.hidden = true;
      toolbar.inert = false;
      closeSettings();
      updateControls();
      layoutToolbar(); // Read-only hides tools, so recentre the shorter bar.
      syncCamera();
      requestPaint();
    },
    setFullscreenState({ supported, active, pending }) {
      if (destroyed) return;
      fullscreenActive = !!active;
      fullscreenButton.hidden = !supported;
      fullscreenButton.disabled = !!pending;
      const label = active ? '退出全屏' : '进入全屏';
      fullscreenButton.title = label;
      fullscreenButton.setAttribute('aria-label', label);
      fullscreenButton.setAttribute('aria-pressed', String(!!active));
      fullscreenButton.innerHTML = icon(active ? 'exitFullscreen' : 'fullscreen');
      layoutToolbar();
    },
    load(draft) {
      if (destroyed) return;
      // Validate first, so a malformed incoming draft cannot erase current ink.
      const next = new WhiteboardModel(draft).getDraft();
      cancelInteraction();
      selectedIds=[];captureGeneration++;closePalette();
      if(capturePreview.open)capturePreview.close();
      model.load(next);
      loadGeneration++;
      localCamera = model.viewport;
      if (readOnly) readOnlyCamera = model.viewport;
      syncCamera();
      confirmation.hidden = true;
      toolbar.inert = false;
      closeSettings();
      report();
      updateControls();
      requestPaint();
    },
    // Changes whenever load() resets the camera, so hosts can restore their view.
    get loadGeneration() { return loadGeneration; },
    getDraft() { return model.getDraft(); },
    getLayout() { return model.layout; },
    initializeLayout(width) {
      if (destroyed || readOnly || !model.initializeLayout(width)) return false;
      syncCamera();updateControls();emitChange();requestPaint();return true;
    },
    getViewCamera() { return displayCamera(); },
    setViewCamera(camera) {
      if (destroyed) return false;
      // This is a host layout override, not a draft mutation. Keep the saved
      // draft camera and undo history intact, including during an active gesture.
      const next = camera === null ? null : normalizeViewport(camera);
      if (viewCamera === next || (viewCamera && next &&
          viewCamera.x === next.x && viewCamera.y === next.y && viewCamera.zoom === next.zoom)) return false;
      viewCamera = next;
      if (mode === 'practice') { syncCamera(); requestPaint(); }
      return true;
    },
    setViewport(viewport, { emit = true } = {}) {
      if (destroyed) return false;
      // Validate before finishing ink so rejected layout adjustments have no effect.
      const next = normalizeViewport(viewport);
      finishInteraction();
      const changed = setDraftCamera(next);
      syncCamera();
      updateControls();
      if (changed && emit) emitViewChange();
      requestPaint();
      return changed;
    },
    setMode(next) {
      if (!['practice', 'draft'].includes(next)) throw new TypeError('Unknown whiteboard mode');
      if (destroyed || mode === next) return;
      finishInteraction();
      mode = next;
      canvas.hidden = mode === 'practice';
      syncCamera();
      syncScroll();
      root.classList.toggle('qf-whiteboard--practice', mode === 'practice');
      root.classList.toggle('qf-whiteboard--draft', mode === 'draft');
      toolbar.hidden = mode === 'practice';
      selectedIds=[];closePalette();stopToolbarDrag();layoutToolbar();
      paperElement.hidden = mode === 'practice';
      canvas.tabIndex = mode === 'draft' ? 0 : -1;
      confirmation.hidden = true;
      toolbar.inert = false;
      closeSettings();
      eraserCursor = null;
      requestPaint();
    },
    flush() { finishInteraction(); return model.getDraft(); },
    destroy() {
      if (destroyed) return;
      cancelInteraction();
      captureGeneration++;captureBlob=null;stopToolbarDrag();
      if(captureUrl)win.URL.revokeObjectURL(captureUrl);
      destroyed = true;
      observer?.disconnect();
      for (const cleanup of listeners) cleanup();
      if (frame) win.cancelAnimationFrame(frame);
      stopSettle();
      for (const { name, value, priority } of previousCameraProperties) {
        if (value) container.style.setProperty(name, value, priority);
        else container.style.removeProperty(name);
      }
      toolbar.remove();
      for (const popup of popups) popup.remove();
      paperElement.remove();
      root.remove();
    },
  };
}
