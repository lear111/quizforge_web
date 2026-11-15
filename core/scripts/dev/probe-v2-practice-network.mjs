// A genuinely different loopback origin receives real browser requests; no
// Playwright route abort can hide an outbound request from this assertion.
import http from 'node:http';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const core = fileURLToPath(new URL('../../', import.meta.url));
export async function probeNetwork(browser, baseline = false) {
  const received = [];
  const collector = http.createServer((req, res) => {
    received.push(req.url);
    res.setHeader('Content-Type', 'text/javascript');
    res.end('/* synthetic collector */');
  });
  const compiled = await build({
    entryPoints: [path.join(core, 'frontend/src/v2/services/page.ts')],
    bundle: true,
    write: false,
    format: 'iife',
    globalName: 'ProbePages',
  });
  const nonce = 'synthetic-network-probe-nonce';
  let host;
  try {
    await new Promise((resolve) => collector.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${collector.address().port}`;
    const actions = {
      'nonce-script': `const script=document.createElement('script');script.nonce=document.scripts[0]?.nonce||'';script.src=target;document.head.append(script);`,
      // A removed nonce is still potentially recoverable from a CSP event.
      'policy-nonce-script': `addEventListener('securitypolicyviolation',event=>{const match=/nonce-([^']+)/.exec(event.originalPolicy);if(match){const script=document.createElement('script');script.nonce=match[1];script.src=target;document.head.append(script);}},{once:true});fetch(target).catch(()=>{});`,
      fetch: 'fetch(target).catch(()=>{});',
      xhr: 'const xhr=new XMLHttpRequest();xhr.open("GET",target);xhr.send();',
      beacon: 'navigator.sendBeacon(target,"synthetic");',
      image: 'const image=new Image();image.src=target;document.body.append(image);',
      css: 'const style=document.createElement("style");style.textContent=`@import url("${target}"); body{background:url("${target}")}`;document.head.append(style);',
      stylesheet:
        'const link=document.createElement("link");link.rel="stylesheet";link.href=target;document.head.append(link);',
      media:
        'const audio=document.createElement("audio");audio.src=target;document.body.append(audio);audio.load();',
      iframe:
        'const frame=document.createElement("iframe");frame.src=target;document.body.append(frame);',
      object:
        'const object=document.createElement("object");object.data=target;document.body.append(object);',
      form: 'const form=document.createElement("form");form.action=target;document.body.append(form);form.submit();finish("sandbox-or-CSP");',
      popup: 'window.open(target);finish("sandbox");',
      navigation: 'location.href=target;',
      import: 'import(target).catch(()=>{});',
      worker: 'try{new Worker(target)}catch{finish("worker-origin-check");}',
      websocket: 'try{new WebSocket(target.replace("http:","ws:"))}catch{finish("CSP");}',
      eventsource:
        'const source=new EventSource(target);source.onerror=()=>{source.close();finish("error");};',
    };
    const cases = [];
    host = http.createServer((req, res) => {
      const route = new URL(req.url, 'http://probe.test'),
        kind = route.searchParams.get('kind') ?? 'nonce-script';
      const locked = route.searchParams.get('locked') === 'true';
      const target = origin + '/' + kind;
      const author = `QF.page.register({async load(context){
        const target=${JSON.stringify(target)}+'?data='+encodeURIComponent(JSON.stringify(context));
        await new Promise((resolve,reject)=>{
          const timer=setTimeout(()=>reject(new Error('No network/blocked completion event')),5000);
          const finish=()=>{clearTimeout(timer);resolve();};
          addEventListener('securitypolicyviolation',finish,{once:true});
          addEventListener('error',finish,{once:true});
          try{${actions[kind]}}catch{finish();}
          ${kind === 'nonce-script' ? 'const s=document.scripts[document.scripts.length-1];s.onload=s.onerror=finish;' : ''}
        });
      },getAnswer(){return {selected:'B'}}});`;
      const boot = `addEventListener('securitypolicyviolation',event=>{if(event.effectiveDirective==='frame-src'&&event.blockedURI.startsWith(${JSON.stringify(origin)}))document.body.dataset.complete='true';});const instance=ProbePages.mountQuestionPage(document.getElementById('app'),${JSON.stringify({ html: '<p>synthetic</p>', js: author, css: '', sdks: [] })},${JSON.stringify({ question: { stem: 'network test' }, answer: { selected: 'B' }, solution: locked ? { answer: 'private synthetic marker' } : null, result: null, item: { maxScore: 2 }, mode: 'practice', locked })},${JSON.stringify(nonce)});instance.ready.then(()=>requestAnimationFrame(()=>requestAnimationFrame(()=>document.body.dataset.complete='true')));`;
      res.setHeader(
        'Content-Security-Policy',
        `default-src 'none'; script-src 'nonce-${nonce}'${baseline ? '' : ' blob:'}; style-src 'self' 'unsafe-inline'; img-src data: blob:; connect-src 'self'; frame-src 'self'; worker-src blob:; base-uri 'none'; frame-ancestors 'none'`,
      );
      res.end(
        `<div id="app"></div><script nonce="${nonce}">${compiled.outputFiles[0].text}</script><script nonce="${nonce}">${boot.replaceAll('</', '<\\/')}</script>`,
      );
    });
    await new Promise((resolve) => host.listen(0, '127.0.0.1', resolve));
    for (const locked of baseline ? [true] : [false, true]) {
      for (const kind of baseline ? ['nonce-script'] : Object.keys(actions)) {
        const page = await browser.newPage(),
          before = received.length;
        const diagnostics = [];
        page.on('pageerror', (error) => diagnostics.push(error.message));
        try {
          await page.goto(`http://127.0.0.1:${host.address().port}/?kind=${kind}&locked=${locked}`);
          await page.waitForFunction(() => document.body.dataset.complete === 'true');
        } catch (error) {
          // The diagnostic intentionally includes the cause text in its existing message.
          // eslint-disable-next-line preserve-caught-error
          throw new Error(
            `Network probe ${kind} locked=${locked}: ${error.message}; page errors=${JSON.stringify(diagnostics)}; received=${JSON.stringify(received)}`,
          );
        } finally {
          await page.close();
        }
        cases.push({ kind, locked, requests: received.length - before });
      }
    }
    if (!baseline) {
      assert.deepEqual(received, [], 'author scripts must not reach the external collector');
    }
    return { requests: received.length, baseline, cases };
  } finally {
    await Promise.all(
      [host, collector]
        .filter(Boolean)
        .map((server) => new Promise((resolve) => server.close(resolve))),
    );
  }
}
