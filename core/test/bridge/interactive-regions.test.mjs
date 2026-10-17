import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { installFrameCapture } from '../../web/bridge/frame-capture.js';

// Run the serialized frame script in a DOM. jsdom has no layout, so each element
// reports a fixed box; merging and filtering stay production code.
test('frames report disjoint boxes for controls a learner can use', async t => {
  const dom = new JSDOM(`<body>
    <label id="option" data-box="10,10,200,40"><input type="radio" data-box="20,20,12,12">A</label>
    <div id="card" style="cursor:pointer" data-box="10,40,200,40">B</div>
    <p data-box="0,100,300,20">Stem text</p>
    <button disabled data-box="0,140,80,30">Off</button>
    <div data-qf-interactive="false"><button data-box="0,200,80,30">Hidden</button></div>
    <textarea data-box="0,260,300,60"></textarea>
  </body>`, { runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  const { window } = dom, sent = [];
  window.Element.prototype.getClientRects = function () {
    const box = this.dataset?.box?.split(',').map(Number);
    return box ? [{ left: box[0], top: box[1], width: box[2], height: box[3] }] : [];
  };
  window.parent.postMessage = value => sent.push(JSON.parse(JSON.stringify(value)));
  window.eval(`(${installFrameCapture})({session:'region-session'})`);
  await new Promise(resolve => setTimeout(resolve, 120));
  const message = sent.find(value => value.kind === 'interactive-regions');
  assert.equal(message.channel, 'quizforge-extension');
  assert.equal(message.session, 'region-session');
  // The label and pointer card overlap and merge; the input inside adds nothing.
  assert.deepEqual(message.rects, [[10, 10, 201, 71], [0, 260, 301, 61]]);
  window.document.querySelector('#card').remove();
  await new Promise(resolve => setTimeout(resolve, 120));
  assert.deepEqual(sent.filter(value => value.kind === 'interactive-regions').at(-1).rects, [[10, 10, 201, 41], [0, 260, 301, 61]]);
});
