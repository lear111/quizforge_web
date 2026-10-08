// The v1 bridge is serialized into the sandbox. Keep this function self-contained.
export function bootstrapV1(boot) {
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
  const api=Object.freeze({...boot.api,capabilities:Object.freeze([...boot.api.capabilities])});
  globalThis.QF=Object.freeze({
    api,
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
