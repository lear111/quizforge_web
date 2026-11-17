import { parseFragment } from 'parse5';
import { object } from './errors.js';

/** @param {unknown} value @returns {Set<string>} */
export function resourceReferences(value) {
  const references = new Set();
  const pending = [value];
  while (pending.length) {
    const current = pending.pop();
    if (typeof current === 'string') {
      // Temporary legacy JSON image/reference support; do not rewrite data.
      if (current.startsWith('qf-asset:')) {
        references.add(current);
      }
      htmlReferences(current, references);
    } else if (Array.isArray(current) || object(current)) {
      const children = Array.isArray(current) ? current : Object.values(current);
      for (let index = children.length - 1; index >= 0; index--) {
        pending.push(children[index]);
      }
    }
  }
  return references;
}

/** @param {string} html @param {Set<string>} references */
function htmlReferences(html, references) {
  const nodes = parseFragment(html).childNodes.toReversed();
  while (nodes.length) {
    const node = nodes.pop();
    if (!node) {
      continue;
    }
    if (
      'tagName' in node &&
      node.tagName === 'img' &&
      node.namespaceURI === 'http://www.w3.org/1999/xhtml'
    ) {
      const src = node.attrs.find((attribute) => attribute.name === 'src')?.value;
      if (src?.startsWith('qf-asset:')) {
        references.add(src);
      }
    }
    if ('childNodes' in node) {
      for (const child of node.childNodes.toReversed()) {
        nodes.push(child);
      }
    }
  }
}
