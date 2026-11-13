import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { capturePage, cleanSnapshot } from '../../scripts/dev/v2-static-snapshot-dom.mjs';

test('snapshot probe records live controls, canvas and image identity, then strips active markup', () => {
  const dom = new JSDOM('<div id="question"><input type="radio"><textarea>default</textarea><select><option>first</option><option>second</option></select><img src="blob:example"><canvas width="2" height="3"></canvas><math><mfrac><mi>a</mi><mi>b</mi></mfrac></math><script></script><img src="https://snapshot.invalid/picture" onerror="void(0)"><a href="javascript:void(0)">link</a><iframe></iframe><object></object></div>');
  const { document } = dom.window;
  const root = document.querySelector('#question');
  root.querySelector('input').checked = true;
  root.querySelector('textarea').value = 'typed text';
  root.querySelector('select').selectedIndex = 1;
  const png = 'data:image/png;base64,YQ==';
  root.querySelector('canvas').toDataURL = type => { assert.equal(type, 'image/png'); return png; };
  const html = capturePage(root, new Map([['qf-asset:assets/image.png', { url: 'blob:example' }]]));
  const stored = document.createElement('template'); stored.innerHTML = cleanSnapshot(html, null, document);
  assert.equal(stored.content.querySelector('input').checked, true);
  assert.equal(stored.content.querySelector('input').disabled, true);
  assert.equal(stored.content.querySelector('textarea').value, 'typed text');
  assert.equal(stored.content.querySelector('select').selectedIndex, 1);
  assert.deepEqual([...stored.content.querySelectorAll('img')].map(image => image.getAttribute('src')), ['qf-asset:assets/image.png', png, null]);
  assert.equal(stored.content.querySelector('mfrac').namespaceURI, 'http://www.w3.org/1998/Math/MathML');
  assert.equal(stored.content.querySelector('script, canvas, iframe, object, [onerror], [href]'), null);
  assert.doesNotMatch(cleanSnapshot(html, {}, document), /qf-asset:|https:|blob:/);
  assert.equal((cleanSnapshot(html, { 'qf-asset:assets/image.png': png }, document).match(/data:image\/png/g) ?? []).length, 2);
  dom.window.close();
});
