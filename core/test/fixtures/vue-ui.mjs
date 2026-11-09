import { readFileSync } from 'node:fs';

// Evaluate the actual production bundle in each page's realm, as its script tag
// does in a browser. No global DOM replacement or mocked Vue renderer.
const bundle = readFileSync(new URL('../../web/ui/quizforge-ui.js', import.meta.url), 'utf8');
export function loadVueUi(dom) { dom.window.eval(bundle); }
