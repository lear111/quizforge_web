import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { build } from 'esbuild';
import { gzipSync } from 'node:zlib';
import { setImmediate } from 'node:timers/promises';

const directory = new URL('../../shared/richtext/2.0.0/', import.meta.url);
const script = fs.readFileSync(new URL('richtext.js', directory), 'utf8');
function setup(t, get = async () => ({ url: 'blob:synthetic' })) {
  const window = new JSDOM('<!doctype html><div id="root"></div>', { runScripts: 'dangerously' })
    .window;
  t.after(() => window.close());
  window.QF = { resources: { get } };
  window.eval(script);
  const root = window.document.querySelector('#root');
  return { window, root, render: (html) => window.QFRichText.render(root, html) };
}

test('HTML SDK bundle is reproducible, pinned to DOMPurify/KaTeX, and has no editor', async (t) => {
  const result = await build({
    entryPoints: [new URL('src/static.js', directory).pathname.replace(/^\/(\w:)/, '$1')],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    minify: true,
    legalComments: 'eof',
    write: false,
  });
  assert.ok(Buffer.from(result.outputFiles[0].contents).equals(Buffer.from(script)));
  assert.ok(gzipSync(script).length > 0);
  const { window } = setup(t);
  assert.equal(window.QFRichText.version, '2.0.0');
  assert.deepEqual(Object.keys(window.QFRichText).sort(), ['configure', 'render', 'version']);
  assert.match(script, /3\.4\.18/);
  assert.match(script, /0\.16\.43/);
});

test('D54 permits every allowed tag and only its declared attributes', async (t) => {
  const { root, render } = setup(t);
  const tags = [
    'p',
    'br',
    'h1',
    'h2',
    'h3',
    'h4',
    'blockquote',
    'hr',
    'pre',
    'b',
    'strong',
    'i',
    'em',
    'u',
    's',
    'sub',
    'sup',
    'mark',
    'code',
    'span',
    'ul',
    'ol',
    'li',
    'a',
  ];
  await render(
    tags.map((tag) => `<${tag} id="untrusted" class="untrusted" title="no">x</${tag}>`).join('') +
      '<table><thead><tr><th colspan="2" rowspan="3">a</th></tr></thead><tbody><tr><td colspan="2" rowspan="2">b</td></tr></tbody></table>',
  ).ready;
  for (const tag of [...tags, 'table', 'thead', 'tbody', 'tr', 'th', 'td']) {
    assert.ok(root.querySelector(tag), tag);
  }
  assert.equal(root.querySelectorAll('[id],[title],.untrusted').length, 0);
  assert.equal(root.querySelector('th').colSpan, 2);
  assert.equal(root.querySelector('td').rowSpan, 2);
});

test('DOMPurify strips script, event handlers, foreign namespaces and forbidden attributes', async (t) => {
  const { root, render, window } = setup(t);
  await render(
    '<script>window.pwned=true</script><svg onload="window.pwned=true"><a href="javascript:1">x</a></svg>' +
      '<math><mtext><img src=x onerror=alert(1)></mtext></math><iframe srcdoc="bad"></iframe>' +
      '<p onclick="alert(1)" data-x="no" aria-label="no" src="qf-asset:x">safe</p>' +
      '<form><input autofocus><object>bad</object></form>',
  ).ready;
  assert.equal(window.pwned, undefined);
  assert.equal(
    root.querySelectorAll(
      'script,svg,math,iframe,form,input,object,[onclick],[onerror],[data-x],[aria-label],p[src]',
    ).length,
    0,
  );
});

test('URL hook allows only anchor http/https/mailto and rejects remote, data and unsafe image URLs', async (t) => {
  let calls = 0;
  const { root, render } = setup(t, () => {
    calls++;
  });
  const bad = [
    'javascript:alert(1)',
    'data:image/png;base64,AA',
    '//example.test/a',
    'https://example.test/a',
    'file:///x',
    'qf-asset:../x',
    'qf-asset:/x',
    'qf-asset:x\\y',
    'qf-asset:.qf-v2/state.json',
  ];
  await render(
    bad.map((src) => `<img src="${src}" onerror="bad()">`).join('') +
      [
        'javascript:alert(1)',
        'data:text/html,bad',
        '//example.test',
        'qf-asset:assets/x',
        'https://example.test',
        'http://example.test',
        'mailto:x@example.test',
      ]
        .map((href) => `<a href="${href}">link</a>`)
        .join(''),
  ).ready;
  assert.equal(calls, 0);
  assert.deepEqual(
    [...root.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')),
    ['https://example.test', 'http://example.test', 'mailto:x@example.test'],
  );
  assert.equal(root.querySelectorAll('img[src]').length, 0);
  assert.equal(root.querySelectorAll('.qfrt-image-missing').length, bad.length);
});

test('CSSOM rebuilds exactly the ten allowed CSS properties', async (t) => {
  const { root, render } = setup(t);
  await render(
    '<p style="color:red;background-color:yellow;font-size:18px;font-family:Arial;text-align:center;line-height:2;text-indent:1em;margin-left:2px;vertical-align:top;width:80%;position:fixed;background-image:url(https://example.test/x);--custom:red;opacity:0">x</p>',
  ).ready;
  const style = root.querySelector('p').style;
  assert.deepEqual(
    Array.from(style).sort(),
    [
      'color',
      'background-color',
      'font-size',
      'font-family',
      'text-align',
      'line-height',
      'text-indent',
      'margin-left',
      'vertical-align',
      'width',
    ].sort(),
  );
  assert.doesNotMatch(root.innerHTML, /example\.test|--custom|position|opacity/);
});

test('inline/block math, escaped dollars, invalid LaTeX, and code/pre exclusions', async (t) => {
  const { root, render } = setup(t);
  await render(
    '<p>$x^2$ and $$\\frac{1}{2}$$; price \\$5.00; $\\notACommand{$</p>' +
      '<code>$x$ \\$</code><pre>$$y$$</pre><p>$\\href{https://example.test}{unsafe}$</p>',
  ).ready;
  assert.equal(root.querySelectorAll('.qfrt-math').length, 4);
  assert.equal(root.querySelectorAll('.qfrt-math-block').length, 1);
  assert.ok(root.querySelector('math'));
  assert.match(root.textContent, /price \$5\.00/);
  assert.equal(root.querySelector('code').textContent, '$x$ \\$');
  assert.equal(root.querySelector('pre').textContent, '$$y$$');
  assert.equal(root.querySelectorAll('a[href]').length, 0, 'KaTeX trust:false');
});

test('qf-asset images use host resources; ready waits for real image completion', async (t) => {
  let resolve, reference;
  const { root, render } = setup(t, (value) => {
    reference = value;
    return new Promise((done) => {
      resolve = done;
    });
  });
  const view = render('<p><img src="qf-asset:assets/figure.png" alt="figure" width="320"></p>');
  let ready = false;
  view.ready.then(() => {
    ready = true;
  });
  await Promise.resolve();
  assert.equal(reference, 'qf-asset:assets/figure.png');
  resolve({ url: 'blob:synthetic' });
  await setImmediate();
  assert.equal(ready, false);
  const image = root.querySelector('img');
  assert.equal(image.getAttribute('src'), 'blob:synthetic');
  assert.equal(image.width, 320);
  image.dispatchEvent(new image.ownerDocument.defaultView.Event('load'));
  await view.ready;
  assert.equal(ready, true);
  view.destroy();
  assert.equal(root.childElementCount, 0);
});

test('missing resources and failed image decoding settle ready with a visible failure', async (t) => {
  const { root, render } = setup(t, async () => {
    throw Error('missing');
  });
  await render('<img src="qf-asset:missing.png" alt="figure">').ready;
  assert.match(root.querySelector('img').alt, /图片无法加载/);
  const other = setup(t);
  const view = other.render('<img src="qf-asset:broken.png">');
  await setImmediate();
  other.root.querySelector('img').dispatchEvent(new other.window.Event('error'));
  await view.ready;
  assert.ok(other.root.querySelector('.qfrt-image-missing'));
});

test('destroy settles pending ready, clears handlers and ignores late resources without deleting other renders', async (t) => {
  let resolve;
  const { root, render } = setup(
    t,
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const old = render('<img src="qf-asset:late.png">');
  await Promise.resolve();
  const image = root.querySelector('img');
  const next = render('<p>new</p>');
  old.destroy();
  await old.ready;
  resolve({ url: 'blob:late' });
  await next.ready;
  assert.equal(root.textContent, 'new');
  assert.equal(image.getAttribute('src'), null);
  assert.equal(image.onload, null);
  old.destroy();
  assert.equal(root.textContent, 'new');
  assert.throws(() => render({ type: 'doc' }), /HTML 字符串/);
});
