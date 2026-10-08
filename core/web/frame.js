import {makeRequestId} from './api.js';
const escapeScript = value => value.replace(/<\/script/gi, '<\\/script');
function bootstrap(boot) {
  let hooks,editorHooks,closed=false,context=boot.context,sequence=0;
  const resourceCache=new Map(),resourceUrls=new Set();let resourceBytes=0,editorLoading=null;
  const requests=new Map(),pending=new Set();
  const send=message=>parent.postMessage({...message,channel:'quizforge-extension',session:boot.session},'*');
  const fail=(code,message)=>({ok:false,error:{code,message}});
  const track=value=>{const promise=Promise.resolve(value);pending.add(promise);promise.finally(()=>pending.delete(promise)).catch(()=>{});return promise;};
  const resize=()=>send({kind:'resize',height:Math.ceil(Math.max(document.body.scrollHeight,document.body.getBoundingClientRect?.().height||0))});
  function invoke(method,args) {
    if(closed)return Promise.resolve(fail('PAGE_CLOSED','题目页面已关闭'));
    const id=String(++sequence);
    return track(new Promise(resolve=>{const timer=setTimeout(()=>{requests.delete(id);resolve(fail('REQUEST_TIMEOUT','保存等待超时，请检查连接后重试'));},15000);requests.set(id,{resolve,timer});send({kind:'request',id,method,args});}));
  }
  function load(next) { context=next;try{return track(hooks?.onLoad?.(structuredClone(context)));}catch(error){send({kind:'error',message:error.message});return Promise.reject(error);} }
  async function register(value){if(hooks)throw new Error('页面只能注册一次');if(!value||typeof value.onLoad!=='function')throw new TypeError('必须提供 onLoad');hooks=value;await load(context);if(editorHooks&&boot.editorDraft!=null){if(typeof editorHooks.importDraft!=='function')throw new Error('拓展不支持恢复编辑草稿');await editorHooks.importDraft(structuredClone(boot.editorDraft));}send({kind:'registered'});resize();return structuredClone(context);}
  const unwrap=reply=>{if(!reply?.ok)throw Object.assign(new Error(reply?.error?.message||'资源操作失败'),{code:reply?.error?.code});return reply.data;};
  const resources=Object.freeze({
    async put(file){if(closed)throw new Error('页面已关闭');if(!file||file.size>4*1024*1024||!['image/png','image/jpeg','image/webp','image/gif'].includes(file.type))throw new Error('请选择不超过 4 MiB 的 PNG、JPEG、WebP 或 GIF 图片');const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(new Error('无法读取图片'));reader.readAsDataURL(file);});return unwrap(await invoke('resource-put',{mime:file.type,data}));},
    async get(id){if(!/^[a-f0-9]{64}$/.test(id))throw new Error('图片资源编号无效');if(resourceCache.has(id))return resourceCache.get(id);const loading=(async()=>{const value=unwrap(await invoke('resource-get',{id}));if(closed)throw new Error('页面已关闭');if(resourceBytes+value.size>16*1024*1024)throw new Error('当前题目图片超过 16 MiB 限制');resourceBytes+=value.size;const bytes=Uint8Array.from(atob(value.data),c=>c.charCodeAt(0)),url=URL.createObjectURL(new Blob([bytes],{type:value.mime}));resourceUrls.add(url);return {url,mime:value.mime,size:value.size};})();resourceCache.set(id,loading);loading.catch(()=>resourceCache.delete(id));return loading;}
  });
  function content(){const library=globalThis.QFRichText;if(!library)throw new Error('本拓展没有声明富文本组件依赖');library.configure?.({resources,setExpanded:options=>invoke('editor-layout',options).then(unwrap),loadEditor(){if(!editorLoading)editorLoading=(async()=>{const dependency=boot.dependencies?.find(value=>value.id==='quizforge.richtext');if(!dependency)throw new Error('富文本组件依赖缺失');const asset=unwrap(await invoke('sdk-editor',dependency));if(closed)throw new Error('页面已关闭');const script=document.createElement('script');script.nonce=boot.nonce;script.textContent=asset.script;document.head.append(script);})().catch(error=>{editorLoading=null;throw error;});return editorLoading;}});return library;}
  globalThis.QF=Object.freeze({
    page:Object.freeze({register}),
    editor:Object.freeze({register(value){if(context.mode!=='edit')throw new Error('当前页面不是编辑模式');if(typeof value?.getDocument!=='function')throw new TypeError('必须提供 getDocument');editorHooks=value;return register(value);}}),
    save:value=>invoke('save',value),requestAction:value=>invoke('action',value),
    ai:Object.freeze({grade:(value={})=>invoke('ai-grade',value),getTask:(value={})=>invoke('ai-task',value),retry:(value={})=>invoke('ai-retry',value),confirm:(value={})=>invoke('ai-confirm',value)}),
    ui:Object.freeze({resize}),resources,get content(){return content();}
  });
  addEventListener('message',event=>{const value=event.data;if(event.source!==parent||value?.channel!=='quizforge-host'||value.session!==boot.session)return;
    if(value.kind==='reply'){const item=requests.get(value.id);if(item){clearTimeout(item.timer);requests.delete(value.id);item.resolve(value.reply);}}
    else if(value.kind==='context')load(value.context).catch(error=>send({kind:'error',message:error.message}));
    else if(value.kind==='flush'){(async()=>{try{await hooks?.onFlush?.();while(pending.size)await Promise.allSettled([...pending]);send({kind:'flushed',id:value.id,ok:true});}catch(error){send({kind:'flushed',id:value.id,ok:false,error:{message:error.message||'编辑内容尚未保存'}});}})();}
    else if(value.kind==='read-draft'&&!closed){(async()=>{try{await hooks?.onFlush?.();const supported=typeof editorHooks?.exportDraft==='function';const changed=editorHooks?.hasChanges?!!(await editorHooks.hasChanges()):true;const draft=supported?structuredClone(await editorHooks.exportDraft()):null;send({kind:'editor-draft',id:value.id,ok:true,supported,draft,changed});}catch(error){send({kind:'editor-draft',id:value.id,ok:false,error:{message:error.message||'编辑草稿读取失败'}});}})();}
    else if(value.kind==='read-document'&&!closed){(async()=>{try{if(!editorHooks)throw new Error('拓展未注册编辑接口');const changed=editorHooks.hasChanges?!!(await editorHooks.hasChanges()):true;const document=value.checkOnly?undefined:structuredClone(await editorHooks.getDocument());send({kind:'document',id:value.id,ok:true,document,changed});}catch(error){send({kind:'document',id:value.id,ok:false,error:{code:'INVALID_DOCUMENT',message:error.message||'题目内容不完整'}});}})();}
    else if(value.kind==='dispose'){closed=true;try{hooks?.onDispose?.();}catch{}for(const url of resourceUrls)URL.revokeObjectURL(url);resourceUrls.clear();resourceCache.clear();sizeObserver.disconnect?.();for(const item of requests.values()){clearTimeout(item.timer);item.resolve(fail('PAGE_CLOSED','题目页面已关闭'));}requests.clear();}
  });
  addEventListener('error',event=>send({kind:'error',message:event.message||'题型页面发生错误'}));
  addEventListener('unhandledrejection',event=>send({kind:'error',message:event.reason?.message||'题型操作失败'}));
  for(const name of ['input','change','click'])addEventListener(name,()=>{if(editorHooks&&!closed)Promise.resolve().then(()=>editorHooks.hasChanges?editorHooks.hasChanges():true).then(changed=>send({kind:'editor-dirty',changed:!!changed})).catch(()=>send({kind:'editor-dirty',changed:true}));});
  const sizeObserver=new ResizeObserver(resize);sizeObserver.observe(document.body);sizeObserver.observe(document.documentElement);
}
export function mountExtension(container,assets,context,{onRequest,onError,onDirty,onLayout,editorDraft=null}) {
  const session=makeRequestId(),frame=document.createElement('iframe');frame.className='question-frame';frame.title='题型练习页面';frame.setAttribute('sandbox','allow-scripts');frame.referrerPolicy='no-referrer';
  const nonce=makeRequestId().replace(/[^a-zA-Z0-9]/g,'');const boot={session,context,nonce,dependencies:assets.dependencies||[],editorDraft};
  const policy=`default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'`;
  const start=`(${bootstrap.toString()})(${JSON.stringify(boot).replace(/</g,'\\u003c')});`;
  const phoneStyle=`@media(max-width:600px){html,body{padding:0!important;background:#fff}body>:first-child{border:0!important;border-radius:0!important;box-shadow:none!important}input,textarea,select{font-size:16px!important}}`;
  const libraries=assets.libraries||[];
  frame.srcdoc=`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${policy}"><style>html,body{margin:0;overflow:hidden}*{box-sizing:border-box}${libraries.map(value=>value.style||'').join('\n').replace(/<\/style/gi,'<\\/style')}${assets.style.replace(/<\/style/gi,'<\\/style')}${phoneStyle}</style></head><body>${assets.html}<script nonce="${nonce}">${escapeScript(start)}</script>${libraries.map(value=>`<script nonce="${nonce}">${escapeScript(value.script)}</script>`).join('')}<script nonce="${nonce}">${escapeScript(assets.script)}</script></body></html>`;
  let disposed=false,dirty=false,expanded=false,normalHeight='100px',viewContext=context,resolveReady,rejectReady;
  const ready=new Promise((resolve,reject)=>{resolveReady=resolve;rejectReady=reject;});
  const readyTimer=setTimeout(()=>rejectReady(new Error('题型页面加载超时')),10000);
  const flushes=new Map(),documents=new Map(),drafts=new Map();
  const send=value=>{if(!disposed)frame.contentWindow?.postMessage({...value,channel:'quizforge-host',session},'*');};
  function listener(event){const value=event.data;if(disposed||event.source!==frame.contentWindow||value?.channel!=='quizforge-extension'||value.session!==session)return;
    if(value.kind==='registered'){clearTimeout(readyTimer);resolveReady();}
    else if(value.kind==='resize'&&Number.isFinite(value.height)&&!expanded){normalHeight=`${Math.max(100,Math.min(10000,value.height))}px`;if(frame.style.height!==normalHeight)frame.style.height=normalHeight;}
    else if(value.kind==='error'){clearTimeout(readyTimer);rejectReady(new Error(value.message));onError(String(value.message));}
    else if(value.kind==='flushed'){const item=flushes.get(value.id);if(item){clearTimeout(item.timer);flushes.delete(value.id);if(value.ok===false)item.reject(new Error(value.error?.message||'保存未完成'));else item.resolve();}}
    else if(value.kind==='editor-draft'){const item=drafts.get(value.id);if(item){clearTimeout(item.timer);drafts.delete(value.id);if(value.ok){dirty=!!value.changed;item.resolve({draft:value.draft,changed:dirty,supported:!!value.supported});}else item.reject(new Error(value.error?.message||'编辑草稿读取失败'));}}
    else if(value.kind==='document'){const item=documents.get(value.id);if(item){clearTimeout(item.timer);documents.delete(value.id);if(value.ok){dirty=!!value.changed;item.resolve({document:value.document,changed:!!value.changed});}else item.reject(Object.assign(new Error(value.error?.message||'题目内容不完整'),{code:value.error?.code||'INVALID_DOCUMENT'}));}}
    else if(value.kind==='editor-dirty'){dirty=!!value.changed;onDirty?.(dirty);}
    else if(value.kind==='request'&&value.method==='editor-layout'&&typeof value.id==='string'){
      Promise.resolve().then(async()=>{
        if(disposed)throw new Error('编辑页面已关闭');
        const args=value.args;
        if(typeof args?.expanded!=='boolean'||args.expanded&&(!Number.isFinite(args.contentWidth)||args.contentWidth<100||args.contentWidth>2400))throw Object.assign(new Error('编辑窗口参数无效'),{code:'INVALID_REQUEST'});
        if(args.expanded&&!(viewContext.mode==='edit'&&viewContext.capabilities?.canEdit||viewContext.capabilities?.canSave))throw Object.assign(new Error('当前内容为只读'),{code:'READ_ONLY'});
        if(!onLayout)throw Object.assign(new Error('宿主未提供高级编辑窗口'),{code:'LAYOUT_UNAVAILABLE'});
        await onLayout(args,frame);
        if(disposed){onLayout({expanded:false},frame);return;}
        expanded=args.expanded;
        frame.style.height=expanded?'100dvh':normalHeight;
        send({kind:'reply',id:value.id,reply:{ok:true,data:{expanded}}});
      }).catch(error=>send({kind:'reply',id:value.id,reply:{ok:false,error:{code:error.code||'HOST_ERROR',message:error.message}}}));
    }
    else if(value.kind==='request'&&typeof value.id==='string'&&['save','action','resource-put','resource-get','sdk-editor','ai-grade','ai-task','ai-retry','ai-confirm'].includes(value.method)){
      Promise.resolve().then(()=>onRequest(value.method,value.args)).then(reply=>send({kind:'reply',id:value.id,reply})).catch(error=>send({kind:'reply',id:value.id,reply:{ok:false,error:{code:error.code||'HOST_ERROR',message:error.message}}}));
    }
  }
  window.addEventListener('message',listener);container.append(frame);
  return {
    frame,ready,get isDirty(){return dirty;},update(next){viewContext=next;dirty=false;send({kind:'context',context:next});},
    getDocument({checkOnly=false}={}){if(disposed)return Promise.reject(new Error('编辑页面已关闭'));const id=makeRequestId();return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{documents.delete(id);reject(new Error('编辑页面读取超时，当前修改仍保留'));},10000);documents.set(id,{resolve,reject,timer});send({kind:'read-document',id,checkOnly});});},
    exportDraft(){if(disposed)return Promise.reject(new Error('编辑页面已关闭'));const id=makeRequestId();return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{drafts.delete(id);reject(new Error('编辑草稿读取超时，当前输入仍保留'));},16000);drafts.set(id,{resolve,reject,timer});send({kind:'read-draft',id});});},
    flush(){if(disposed)return Promise.resolve();const id=makeRequestId();return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{flushes.delete(id);reject(new Error('题型页面仍在保存，请稍后重试'));},16000);flushes.set(id,{resolve,reject,timer});send({kind:'flush',id});});},
    destroy(){if(disposed)return;send({kind:'dispose'});disposed=true;if(expanded){expanded=false;try{onLayout?.({expanded:false},frame);}catch{}}clearTimeout(readyTimer);rejectReady(new Error('题型页面已关闭'));window.removeEventListener('message',listener);for(const item of flushes.values()){clearTimeout(item.timer);item.resolve();}flushes.clear();for(const map of [documents,drafts]){for(const item of map.values()){clearTimeout(item.timer);item.reject(new Error('编辑页面已关闭'));}map.clear();}frame.remove();}
  };
}
