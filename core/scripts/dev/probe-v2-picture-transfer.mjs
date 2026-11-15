import http from 'node:http';
import path from 'node:path';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2ioAAAAASUVORK5CYII=',
  'base64',
);
export async function transferProbe(browser, core) {
  const compiled = await build({
    entryPoints: [path.join(core, 'frontend/src/v2/services/page.ts')],
    bundle: true,
    write: false,
    format: 'iife',
    globalName: 'ProbePages',
  });
  const nonce = 'v2-picture-probe',
    author = `QF.page.register({async load(context){const asset=await QF.resources.get('qf-asset:assets/one.png');const img=new Image();img.src=asset.url;document.getElementById('picture').replaceChildren(img);await img.decode();},getAnswer(){return null;}});`;
  const host = http.createServer((req, res) => {
    res.setHeader(
      'Content-Security-Policy',
      `default-src 'none'; script-src 'nonce-${nonce}' blob:; style-src 'unsafe-inline'; img-src data: blob:; connect-src 'self'; frame-src 'self'; base-uri 'none'`,
    );
    const boot = `const bytes=new Uint8Array(${JSON.stringify([...png])}).buffer;
      const instance=ProbePages.mountQuestionPage(document.getElementById('app'),${JSON.stringify({ html: '<div id="picture"></div>', js: author, css: '', sdks: [] })},${JSON.stringify({ question: {}, answer: null, solution: null, result: null, item: {}, mode: 'practice', locked: false })},'${nonce}',{resources:[{assetId:'one',reference:'qf-asset:assets/one.png',bytes,type:'image/png'}]});
      instance.ready.then(()=>{document.body.dataset.detached=String(bytes.byteLength);window.destroy=()=>instance.destroy();document.body.dataset.ready='true';});`;
    res.end(
      `<div id="app"></div><script nonce="${nonce}">${compiled.outputFiles[0].text}</script><script nonce="${nonce}">${boot.replaceAll('</', '<\\/')}</script>`,
    );
  });
  try {
    await new Promise((resolve) => host.listen(0, '127.0.0.1', resolve));
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${host.address().port}`);
    await page.waitForFunction(() => document.body.dataset.ready === 'true');
    assert.equal(
      await page.locator('body').getAttribute('data-detached'),
      '0',
      'real transfer detaches host buffer',
    );
    assert.equal(
      await page
        .frameLocator('iframe')
        .locator('img')
        .evaluate((img) => img.naturalWidth),
      1,
    );
    await page.evaluate(() => window.destroy());
    assert.equal(await page.locator('iframe').count(), 0);
    await page.close();
    return { hostBufferBytesAfterTransfer: 0, decodedWidth: 1, frameRemoved: true };
  } finally {
    host.closeAllConnections();
    await new Promise((resolve) => host.close(resolve));
  }
}
