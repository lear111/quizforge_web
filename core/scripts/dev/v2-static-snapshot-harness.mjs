import { mountQuestionPage } from '../../frontend/src/v2/page';
import { createPageSourceCache } from '../../frontend/src/v2/source-cache';
import { createGradingService } from '../../frontend/src/v2/grading';
import { cleanSnapshot } from './v2-static-snapshot-dom.mjs';

const get = async (route, signal) => {
  const response = await fetch(route, { signal });
  if (!response.ok) throw Error('HTTP ' + response.status + ': ' + route);
  return response;
};
const cache = createPageSourceCache({
  json: async (route, signal) => (await get(route, signal)).json(),
  text: async (route, signal) => (await get(route, signal)).text(),
});
const nonce = document.currentScript.nonce;
const grader = createGradingService({
  scriptNonce: nonce,
  loadSource: async (id, signal) => (await get('/api/v2/extensions/' + id + '/files/grade-js', signal)).text(),
});
const live = document.querySelector('#live'), saved = document.querySelector('#saved');
let page, artifact;
const escapeStyle = css => css.replaceAll('</', '<\\/');
window.staticProbe = {
  async score(q) {
    const [output] = await grader.grade(q.extension.artifactId, [q]);
    return output.result;
  },
  async load(q) {
    const start = performance.now();
    cache.scope(q.bankId, q.snapshotId, '');
    const type = q.extension.artifactId, sources = await cache.load(type);
    const assetRoot = '/api/v2/banks/' + q.bankId + '/questions/' + encodeURIComponent(q.questionId) + '/assets/';
    const images = {};
    const resources = await Promise.all(q.resources.map(async resource => {
      const response = await get(assetRoot + resource.assetId + '?snapshotId=' + encodeURIComponent(q.snapshotId));
      const mime = response.headers.get('Content-Type').split(';')[0];
      if (!['image/png','image/jpeg','image/gif','image/webp'].includes(mime)) throw Error('Probe only supports raster images');
      const bytes = await response.arrayBuffer();
      const data = await new Promise((resolve, reject) => {
        const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject;
        reader.readAsDataURL(new Blob([bytes], { type: mime }));
      });
      images[resource.reference] = data;
      return { ...resource, bytes, type: mime };
    }));
    const context = { mode: 'archive', question: q.question, answer: q.answer, solution: q.solution, result: q.result, item: q.item,
      locked: true, can: { submit: false, retry: false }, appearance: { theme: 'light' } };
    const reused = artifact === type;
    if (reused) await page.update(context, resources);
    else { page?.destroy(); artifact = type; page = mountQuestionPage(live, sources, context, nonce, { resources }); await page.ready; }
    const raw = await page.capture(), html = cleanSnapshot(raw);
    return { html, raw, images, css: sources.css, duration: performance.now() - start, reused };
  },
  render(html, css, images) {
    const clean = cleanSnapshot(html, images);
    const frame = document.createElement('iframe');
    frame.setAttribute('sandbox', '');
    frame.srcdoc = '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'none\'; connect-src \'none\'; style-src \'unsafe-inline\'; img-src data:; form-action \'none\'; base-uri \'none\'"><style>html,body{margin:0}#question{display:flow-root}' + escapeStyle(css) + '</style><div id="question">' + clean + '</div></html>';
    saved.replaceChildren(frame);
    return clean;
  },
};
