import { ANSWERED_PART_LIMIT, mergeAnswered } from '../../../../shared/v2/answered.js';
import type { Answered } from '../../../../shared/v2/answered.js';
// Each question gets its own opaque page. No state or solution crosses frames.
export interface PageContext {
  question: unknown;
  answer: unknown;
  solution: unknown;
  result: unknown;
  item: { parts?: { id: string }[] };
  locked: boolean;
  can: { submit: boolean; retry: boolean };
  appearance: { theme: 'light' | 'dark' };
}
export interface PageSources {
  html: string;
  js: string;
  css: string;
  sdks: string[];
}
export interface Picture {
  assetId: string;
  reference: string;
  bytes: ArrayBuffer;
  type: string;
}
interface PageOptions {
  title?: string;
  resources?: Picture[];
  onChanged?(kind: 'choice' | 'text' | 'ink', answered?: Answered): void;
  onSubmit?(): Promise<void>;
  onRetry?(): Promise<void>;
}
const literal = (value: unknown) => JSON.stringify(value).replaceAll('<', '\\u003c');
const id = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(16)), (n) =>
    n.toString(16).padStart(2, '0'),
  ).join('');
export function mountQuestionPage(
  container: HTMLElement,
  sources: PageSources,
  context: PageContext,
  nonce: string,
  options: PageOptions = {},
) {
  const frame = document.createElement('iframe'),
    channel = id();
  frame.title = `${options.title ?? '题目'}作答`;
  frame.setAttribute('sandbox', 'allow-scripts');
  let disposed = false,
    faulted = false,
    initialized = false,
    version = 0,
    sequence = 0,
    resolveReady!: () => void,
    rejectReady!: (error: Error) => void;
  let activeContext = context,
    actionRunning = false;
  const sent = new Set<string>();
  const pending = new Map<
    number,
    { kind: string; resolve(value: unknown): void; reject(error: Error): void }
  >();
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  void ready.catch(() => {});
  const runtime = `(()=>{
    // The nonce is a host capability, never an author capability. Remove both
    // readable DOM copies before running any SDK or author-provided script.
    document.currentScript.remove();
    document.querySelector('meta[http-equiv="Content-Security-Policy"]').remove();
    // CSP violation events can reveal the original policy (including a nonce).
    // Add a second, intersecting policy: even a recovered nonce cannot approve
    // an external/inline script once author code begins. Existing code keeps
    // running; all subsequently loaded SDK/author scripts must be blob URLs.
    const authorPolicy=document.createElement('meta');
    authorPolicy.httpEquiv='Content-Security-Policy';authorPolicy.content="script-src blob:";
    document.head.append(authorPolicy);
    const channel=${literal(channel)}, initialContext=${literal(context)};
    let page, version=0, context=initialContext, chain=Promise.resolve(), applying=false, actionId=0, resizeFrame;
    const actions=new Map();
    const assets=new Map(), urls=new Map();
    const send=(value,scope=version)=>parent.postMessage({...value,channel,version:scope},'*');
    const root=()=>document.getElementById('question');
    let lastHeight=0;
    const reportHeight=()=>{if(resizeFrame!==undefined)return;resizeFrame=requestAnimationFrame(()=>{resizeFrame=undefined;const node=root();if(!node)return;const height=Math.ceil(Math.max(node.scrollHeight,node.getBoundingClientRect().height));if(height>0&&height!==lastHeight){lastHeight=height;send({kind:'height',height});}});};
    const observer=new ResizeObserver(reportHeight);
    const revoke=()=>{observer.disconnect();if(resizeFrame!==undefined)cancelAnimationFrame(resizeFrame);for(const pending of actions.values())pending.reject(new Error('题目已关闭。'));actions.clear();for(const url of urls.values())URL.revokeObjectURL(url);urls.clear();assets.clear();};
    addEventListener('pagehide',revoke);addEventListener('unload',revoke);
    const resources=Object.freeze({async get(reference){const asset=assets.get(reference);if(!asset)throw new Error('图片不可用');return {...asset};}});
    const action=name=>{
      if(applying||context.can?.[name]!==true)return Promise.reject(new Error('当前不允许此操作。'));
      const request=++actionId, scope=version;
      return new Promise((resolve,reject)=>{actions.set(request,{resolve,reject,scope});send({kind:'action',action:name,request},scope);});
    };
    globalThis.QF=Object.freeze({resources,page:Object.freeze({register(value){page=value;},changed(value){
      if(applying||!['choice','text','ink'].includes(value?.kind))return;
      const extra={};if(Object.hasOwn(value,'answered')){
        const reported=value.answered;
        if(typeof reported!=='boolean'&&(!reported||typeof reported!=='object'||Array.isArray(reported)||Object.keys(reported).length>${ANSWERED_PART_LIMIT}||Object.values(reported).some(flag=>typeof flag!=='boolean')))throw new TypeError('作答状态格式无效。');
        extra.answered=reported;
      }send({kind:'changed',inputKind:value.kind,...extra});
    },submit:()=>action('submit'),retry:()=>action('retry')})});
    addEventListener('message',event=>{
      if(event.source!==parent||event.data?.channel!==channel)return;
      const data=event.data;
      if(data.kind==='dispose'){revoke();return;}
      if(data.kind==='action-result'){const pending=actions.get(data.request);if(!pending||pending.scope!==data.version)return;actions.delete(data.request);if(data.error)pending.reject(new Error(data.error));else pending.resolve();return;}
      if(data.kind==='load'||data.kind==='context'){
        chain=chain.then(async()=>{if(data.version<version)return;version=data.version;context=data.context;applying=true;
          try{
            for(const asset of data.resources||[]){
              if(!(asset.bytes instanceof ArrayBuffer)||!asset.type.startsWith('image/')||urls.has(asset.assetId))continue;
              const url=URL.createObjectURL(new Blob([asset.bytes],{type:asset.type}));urls.set(asset.assetId,url);
              const value={url,assetId:asset.assetId,type:asset.type};assets.set(asset.reference,value);assets.set(asset.assetId,value);
            }
            await page.load(context);reportHeight();send({kind:data.kind==='load'?'ready':'updated',request:data.request});
          }catch{send({kind:data.kind==='load'?'error':'updated',request:data.request,error:true});}
          finally{applying=false;}
        });return;
      }
      if(data.kind!=='answer'||data.version!==version)return;
      const scope=version;
      (async()=>{try{send({kind:data.kind,request:data.request,value:await page.getAnswer()},scope);}
      catch{send({kind:data.kind,request:data.request,error:true},scope);}})();
    });
    (async()=>{try{
      // DOMParser keeps scripts in author markup inert. Author JS has one entry.
      const markup=new DOMParser().parseFromString(${literal(sources.html)},'text/html');
      markup.querySelectorAll('script,iframe,object,embed,base,meta,link').forEach(node=>node.remove());
      document.getElementById('question').append(...markup.body.childNodes);
      for(const source of ${literal([...sources.sdks, sources.js])}){
        const script=document.createElement('script');
        const url=URL.createObjectURL(new Blob([source],{type:'text/javascript'}));
        try{await new Promise((resolve,reject)=>{script.onload=resolve;script.onerror=reject;script.src=url;document.head.append(script);});}
        finally{script.remove();URL.revokeObjectURL(url);}
      }
      if(!page||typeof page.load!=='function'||typeof page.getAnswer!=='function')throw new Error();
      observer.observe(root());
      // Adapt qf-asset image nodes for the existing immutable rich-text SDK.
      // Only this frame instance is configured; no published SDK file changes.
      if(globalThis.QFRichText){
        QFRichText.configure({resources});const render=QFRichText.render;
        const adapt=value=>{
          if(Array.isArray(value))return value.map(adapt);
          if(!value||typeof value!=='object')return value;
          const copy=Object.fromEntries(Object.entries(value).map(([key,child])=>[key,adapt(child)]));
          if(copy.type==='image'&&typeof copy.attrs?.src==='string'){
            const ref=copy.attrs.src;copy.attrs.assetId=assets.get(ref)?.assetId||'0'.repeat(64);delete copy.attrs.src;
          }return copy;
        };
        QFRichText.render=(node,doc,config)=>render(node,adapt(doc),config);
      }
      send({kind:'initialized'});
    }catch{send({kind:'error'});}})();})();`;
  const handler = (event: MessageEvent) => {
    if (
      disposed ||
      event.source !== frame.contentWindow ||
      event.data?.channel !== channel ||
      event.data.version !== version
    ) {
      return;
    }
    if (event.data.kind === 'initialized' && !initialized) {
      initialized = true;
      post('load', context, options.resources ?? []);
    }
    if (event.data.kind === 'ready') {
      resolveReady();
    }
    if (event.data.kind === 'error') {
      faulted = true;
      rejectReady(new Error('题型页面未能加载，请重新打开本题。'));
    }
    if (event.data.kind === 'changed' && ['choice', 'text', 'ink'].includes(event.data.inputKind)) {
      let answered: Answered | undefined;
      try {
        if (Object.hasOwn(event.data, 'answered')) {
          answered = mergeAnswered(event.data.answered, activeContext.item);
        }
      } catch {
        return;
      }
      options.onChanged?.(event.data.inputKind, answered);
    }
    if (
      event.data.kind === 'height' &&
      typeof event.data.height === 'number' &&
      Number.isFinite(event.data.height) &&
      event.data.height > 0
    ) {
      frame.style.height = `${Math.ceil(event.data.height)}px`;
    }
    if (
      event.data.kind === 'action' &&
      ['submit', 'retry'].includes(event.data.action) &&
      Number.isSafeInteger(event.data.request)
    ) {
      const scope = version,
        action = event.data.action as 'submit' | 'retry',
        request = event.data.request;
      const reply = (error?: string) => {
        if (!disposed) {
          frame.contentWindow?.postMessage(
            {
              channel,
              version: scope,
              kind: 'action-result',
              request,
              ...(error ? { error } : {}),
            },
            '*',
          );
        }
      };
      const callback = action === 'submit' ? options.onSubmit : options.onRetry;
      if (faulted || actionRunning || !activeContext.can?.[action] || !callback) {
        reply('当前不允许此操作。');
        return;
      }
      actionRunning = true;
      void Promise.resolve()
        .then(callback)
        .then(
          () => reply(),
          () => reply('操作未完成，请查看宿主提示并重试。'),
        )
        .finally(() => {
          actionRunning = false;
        });
    }
    if (['answer', 'updated'].includes(event.data.kind)) {
      const request = pending.get(event.data.request);
      if (!request || request.kind !== event.data.kind) {
        return;
      }
      pending.delete(event.data.request);
      if (event.data.error) {
        if (event.data.kind === 'updated') {
          faulted = true;
        }
        request.reject(
          new Error(
            event.data.kind === 'updated'
              ? '题型页面更新失败，请重新打开本题。'
              : '无法读取作答，请重试。',
          ),
        );
      } else {
        request.resolve(event.data.value);
      }
    }
  };
  function post(kind: string, context?: PageContext, resources: Picture[] = [], request?: number) {
    const fresh = resources.filter((row) => !sent.has(row.assetId));
    for (const row of fresh) {
      sent.add(row.assetId);
    }
    frame.contentWindow!.postMessage(
      { channel, version, kind, context, resources: fresh, request },
      '*',
      fresh.map((row) => row.bytes),
    );
  }
  let latest = ready;
  async function read(kind: 'answer') {
    await latest;
    if (disposed || faulted) {
      throw new Error(disposed ? '题目已关闭。' : '题型页面更新失败，请重新打开本题。');
    }
    return new Promise<unknown>((resolve, reject) => {
      const request = ++sequence;
      pending.set(request, { kind, resolve, reject });
      post(kind, undefined, [], request);
    });
  }
  window.addEventListener('message', handler);
  // Parent's nonce also applies to srcdoc's inherited CSP. No host origin,
  // network, forms, popups or top-level navigation is granted to author code.
  const attr = nonce.replaceAll('&', '&amp;').replaceAll('"', '&quot;');
  frame.srcdoc = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${attr}' blob:; style-src 'unsafe-inline'; img-src data: blob:; connect-src 'none'; base-uri 'none'; form-action 'none'"><style>html,body{margin:0}#question{display:flow-root}${sources.css.replaceAll('</', '<\\/')}</style><div id="question"></div><script nonce="${attr}">${runtime.replaceAll('</', '<\\/')}</script></html>`;
  container.replaceChildren(frame);
  return {
    ready,
    frame,
    answer: () => read('answer'),
    hasResource: (assetId: string) => sent.has(assetId),
    get can() {
      return { ...activeContext.can };
    },
    get faulted() {
      return faulted;
    },
    update(context: PageContext, resources: Picture[] = []) {
      latest = latest.then(() => {
        if (disposed || faulted) {
          throw new Error(disposed ? '题目已关闭。' : '题型页面更新失败，请重新打开本题。');
        }
        version++;
        activeContext = context;
        for (const entry of pending.values()) {
          entry.reject(new Error('题目状态已更新。'));
        }
        pending.clear();
        return new Promise<void>((resolve, reject) => {
          const request = ++sequence;
          pending.set(request, { kind: 'updated', resolve: () => resolve(), reject });
          post('context', context, resources, request);
        });
      });
      void latest.catch(() => {});
      return latest;
    },
    destroy() {
      if (disposed) {
        return;
      }
      post('dispose');
      disposed = true;
      window.removeEventListener('message', handler);
      rejectReady(new Error('题目已关闭。'));
      for (const request of pending.values()) {
        request.reject(new Error('题目已关闭。'));
      }
      pending.clear();
      frame.remove();
    },
  };
}
