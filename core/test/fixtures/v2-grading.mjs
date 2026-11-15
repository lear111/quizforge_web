import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import { fileURLToPath } from 'node:url';

const bundle = await build({
  entryPoints: [
    fileURLToPath(new URL('../../frontend/src/v2/services/grading.ts', import.meta.url)),
  ],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'browser',
});

const { createGradingService } = await import(
  'data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64')
);

const input = (id) => [
  { questionId: id, question: {}, solution: {}, answer: {}, item: { maxScore: 2 } },
];

const result = (id) => [{ questionId: id, result: { score: 2 } }];

const normalized = (id) => [{ questionId: id, result: { score: 2, parts: null, message: null } }];

const turn = async () => {
  for (let i = 0; i < 8; i++) {
    await Promise.resolve();
  }
};

function fixture(t, options = {}) {
  const dom = new JSDOM('<body></body>', { url: 'http://127.0.0.1:12345/' });
  const service = createGradingService({
    document: dom.window.document,
    loadSource: async () => 'QF.grader.register({grade(){return {score:2}}});',
    ...options,
  });
  t.after(() => {
    service.dispose();
    dom.window.close();
  });
  const frames = () => [...dom.window.document.querySelectorAll('iframe')];
  const observe = (frame) => {
    const messages = [];
    frame.contentWindow.postMessage = (data) => messages.push(data);
    const channel = /const channel = ("[^"]+")/.exec(frame.srcdoc);
    assert.ok(channel, 'real production srcdoc has a scoped channel');
    const send = (data, source = frame.contentWindow) =>
      dom.window.dispatchEvent(
        new dom.window.MessageEvent('message', {
          source,
          data: { channel: JSON.parse(channel[1]), ...data },
        }),
      );
    return { messages, send };
  };
  return { dom, service, frames, observe };
}

export { bundle, createGradingService, input, result, normalized, turn, fixture };
