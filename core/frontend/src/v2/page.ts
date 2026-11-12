// Each question gets its own opaque page. No state or solution crosses frames.
export interface PageContext { question: unknown; answer: unknown; solution: unknown; result: unknown; item: unknown; mode: 'practice'; locked: boolean }
export interface PageSources { html: string; js: string; css: string; sdks: string[] }
const literal = (value: unknown) => JSON.stringify(value).replaceAll('<', '\\u003c');
const id = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), n => n.toString(16).padStart(2, '0')).join('');
export function mountQuestionPage(container: HTMLElement, sources: PageSources, context: PageContext, nonce: string) {
  const frame = document.createElement('iframe'), channel = id();
  frame.title = '单选题作答'; frame.setAttribute('sandbox', 'allow-scripts');
  let disposed = false, sequence = 0, resolveReady!: () => void, rejectReady!: (error: Error) => void;
  const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
  const ready = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  const runtime = `
    const channel=${literal(channel)}, context=${literal(context)};
    const send=value=>parent.postMessage({...value,channel},'*');
    let page;
    const QF=Object.freeze({page:Object.freeze({register(value){page=value;}})});
    addEventListener('message',async event=>{
      if(event.source!==parent||event.data?.channel!==channel||event.data.kind!=='answer')return;
      try{send({kind:'answer',request:event.data.request,value:await page.getAnswer()});}
      catch{send({kind:'answer',request:event.data.request,error:true});}
    });
    (async()=>{try{
      // DOMParser keeps scripts in author markup inert. Author JS has one entry.
      const markup=new DOMParser().parseFromString(${literal(sources.html)},'text/html');
      markup.querySelectorAll('script,iframe,object,embed,base,meta,link').forEach(node=>node.remove());
      document.getElementById('question').append(...markup.body.childNodes);
      for(const source of ${literal([...sources.sdks, sources.js])}){
        const script=document.createElement('script');script.nonce=${literal(nonce)};script.textContent=source;document.head.append(script);
      }
      if(!page||typeof page.load!=='function'||typeof page.getAnswer!=='function')throw new Error();
      await page.load(context);send({kind:'ready'});
    }catch{send({kind:'error'});}})();`;
  const handler = (event: MessageEvent) => {
    if (disposed || event.source !== frame.contentWindow || event.data?.channel !== channel) return;
    if (event.data.kind === 'ready') resolveReady();
    if (event.data.kind === 'error') rejectReady(new Error('题型页面未能加载，请重新打开本题。'));
    if (event.data.kind === 'answer') {
      const request = pending.get(event.data.request); if (!request) return;
      pending.delete(event.data.request);
      if (event.data.error) request.reject(new Error('无法读取作答，请重试。')); else request.resolve(event.data.value);
    }
  };
  window.addEventListener('message', handler);
  // Parent's nonce also applies to srcdoc's inherited CSP. No host origin,
  // network, forms, popups or top-level navigation is granted to author code.
  const attr = nonce.replaceAll('&', '&amp;').replaceAll('"', '&quot;');
  frame.srcdoc = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${attr}'; style-src 'unsafe-inline'; img-src data: blob:; connect-src 'none'; base-uri 'none'; form-action 'none'"><style>${sources.css.replaceAll('</', '<\\/')}</style><div id="question"></div><script nonce="${attr}">${runtime.replaceAll('</', '<\\/')}</script></html>`;
  container.replaceChildren(frame);
  return { ready, frame,
    async answer() { await ready; if (disposed) throw new Error('题目已关闭。'); return new Promise<unknown>((resolve, reject) => { const request = ++sequence; pending.set(request, { resolve, reject }); frame.contentWindow!.postMessage({ channel, kind: 'answer', request }, '*'); }); },
    destroy() { if (disposed) return; disposed = true; window.removeEventListener('message', handler); rejectReady(new Error('题目已关闭。')); for (const request of pending.values()) request.reject(new Error('题目已关闭。')); pending.clear(); frame.remove(); }
  };
}
