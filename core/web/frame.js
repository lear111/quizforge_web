import {makeRequestId} from './api.js';
import {resolveExtensionApi} from './api-bridges.js';
import {validateContentApi} from './page-assets.js';
const escapeScript = value => value.replace(/<\/script/gi, '<\\/script');
export function mountExtension(container,assets,context,{onRequest,onError,onDirty,onLayout,editorDraft=null}) {
  const bridge=resolveExtensionApi(assets.apiVersion);
  if(Object.hasOwn(assets,'contentApi'))validateContentApi(assets.contentApi);
  const session=makeRequestId(),frame=document.createElement('iframe');frame.className='question-frame';frame.title='题型练习页面';frame.setAttribute('sandbox','allow-scripts');frame.referrerPolicy='no-referrer';
  const nonce=makeRequestId().replace(/[^a-zA-Z0-9]/g,'');const boot={session,context,nonce,dependencies:assets.dependencies||[],contentApi:assets.contentApi,editorDraft,api:bridge.api};
  const policy=`default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'`;
  const start=`(${bridge.bootstrap.toString()})(${JSON.stringify(boot).replace(/</g,'\\u003c')});`;
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
