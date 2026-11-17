import { sanitizer } from './sanitize.js';
import { renderMath } from './math.js';
import { loadImages } from './images.js';

const sanitize = sanitizer(globalThis.window);
let configuredResources;
// The existing host configures the resource bridge before author load().
export function configure({ resources } = {}) {
  configuredResources = resources;
}
export function render(container, html) {
  if (typeof html !== 'string') {
    throw new TypeError('富文本内容必须是 HTML 字符串。');
  }
  const root = container.ownerDocument.createElement('div');
  root.className = 'qfrt-document';
  root.append(sanitize(html));
  renderMath(root);
  const images = loadImages(root, configuredResources ?? globalThis.QF?.resources);
  container.replaceChildren(root);
  return {
    ready: images.ready,
    destroy() {
      images.destroy();
      root.remove();
    },
  };
}
