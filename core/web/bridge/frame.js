import {makeRequestId} from '../shared/api.js';
import {resolveExtensionApi} from './api-bridges.js';
import {validateContentApi} from './page-assets.js';
import {inlinePageAssets,prepareLegacyPage} from '../development/development-preview.js';
import {installFrameCapture} from './frame-capture.js';
import {readHostAppearance} from '../shell/appearance.js';
const escapeScript = value => value.replace(/<\/script/gi, '<\\/script');
export function mountExtension(container,assets,context,{onRequest,onError,onDirty,onLayout,editorDraft=null}) {
  if(assets.legacyPage)assets=prepareLegacyPage(assets,{document:container.ownerDocument||document});
  else if(assets.assets?.length)assets=inlinePageAssets(assets,{document:container.ownerDocument||document});
  const bridge=resolveExtensionApi(assets.apiVersion);
  if(Object.hasOwn(assets,'contentApi'))validateContentApi(assets.contentApi);
  // Draft paper and the phone layout keep a white question area, so pages are
  // told to stay opaque there even when the theme panels are transparent.
  const hostDocument=container.ownerDocument||document,phoneLayout=hostDocument.defaultView?.matchMedia?.('(max-width:600px)');
  const answerViewport=container.closest?.('.question-viewport');
  const appearanceSupported=bridge.api.capabilities.includes('appearance');
  const currentAppearance=()=>{const value=readHostAppearance(hostDocument.documentElement),opaque=!!phoneLayout?.matches||!!container.closest?.('.is-draft');return {theme:/^[a-z][a-z-]{0,31}$/.test(value.theme)?value.theme:'default',transparency:opaque?0:value.transparency};};
  let appearance=appearanceSupported?currentAppearance():null;
  const session=makeRequestId(),frame=document.createElement('iframe');frame.className='question-frame';frame.title='题型练习页面';frame.setAttribute('sandbox','allow-scripts');frame.referrerPolicy='no-referrer';
  const nonce=makeRequestId().replace(/[^a-zA-Z0-9]/g,'');const boot={session,context,nonce,dependencies:assets.dependencies||[],contentApi:assets.contentApi,editorDraft,api:bridge.api,legacyPage:assets.legacyPage===true,...(appearance?{appearance}:{}),development:!!context.development&&context.mode!=='history'};
  const policy=`default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'`;
  const captureBoot={session};
  const answerAreasSupported=bridge.api.capabilities.includes('answer-areas')&&assets.answerAreasDeclared===true;
  if(answerAreasSupported){
    if(!['1.0.0','1.1.0','1.2.0','1.3.0','1.3.1','1.3.2','1.4.0','1.4.1'].includes(assets.answerAreaComponent?.version)||typeof assets.answerAreaComponent.script!=='string'||typeof assets.answerAreaComponent.style!=='string')throw new Error('手写答题区组件不完整');
    boot.answerAreasDeclared=true;boot.answerAreaDraft=!!container.closest?.('.is-draft');captureBoot.answerAreas=true;
    boot.answerAreaTools=answerViewport?.qfAnswerAreaTools??null;
  }
  const start=`${answerAreasSupported?assets.answerAreaComponent.script:''}\n(${bridge.bootstrap.toString()})(${JSON.stringify(boot).replace(/</g,'\\u003c')});(${installFrameCapture.toString()})(${JSON.stringify(captureBoot).replace(/</g,'\\u003c')});`;
  // The iframe viewport is the logical card width in draft mode, not the
  // physical phone width. Responsive practice styles remain inside the frame.
  const phoneStyle=`@media(max-width:600px){html,body{padding:0!important;background:#fff}body>:first-child{border:0!important;border-radius:0!important;box-shadow:none!important}input,textarea:not(.qf-answer-shared textarea),select{font-size:16px!important}}`;
  const examSelectors=['[data-qf-action="submit"]','[data-qf-action="retry"]',...(assets.examActionSelectors||[]).filter(selector=>/^#[a-z][a-z0-9-]*$/.test(selector))];
  const examStyle=context.mode==='exam'?`${examSelectors.join(',')}{display:none!important}`:'';
  const libraries=[...(assets.libraries||[])];
  if(answerAreasSupported)libraries.push({style:assets.answerAreaComponent.style,script:''});
  const rootAttributes=appearance?` data-qf-theme="${appearance.theme}" style="--qf-transparency:${appearance.transparency}"`:'';
  frame.srcdoc=`<!doctype html><html lang="zh-CN"${rootAttributes}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${policy}"><style>html,body{margin:0;overflow:hidden}*{box-sizing:border-box}${libraries.map(value=>value.style||'').join('\n').replace(/<\/style/gi,'<\\/style')}${assets.style.replace(/<\/style/gi,'<\\/style')}${phoneStyle}${examStyle}</style></head>${assets.bodyTag||'<body>'}${assets.html}<script nonce="${nonce}">${escapeScript(start)}</script>${libraries.map(value=>`<script nonce="${nonce}">${escapeScript(value.script)}</script>`).join('')}<script nonce="${nonce}">${escapeScript(assets.script)}</script></body></html>`;
  let disposed=false,dirty=false,inputDirty=false,readyDone=false,faulted=false,expanded=false,normalHeight='100px',viewContext=context,resolveReady,rejectReady;
  const ready=new Promise((resolve,reject)=>{resolveReady=resolve;rejectReady=reject;});
  ready.catch(()=>{});
  const readyTimer=setTimeout(()=>{if(!readyDone){readyDone=true;faulted=true;const error=new Error('题型页面加载超时，请检查 QF.page.register 是否完成');rejectReady(error);onError?.(error.message);}},10000);
  const flushes=new Map(),documents=new Map(),drafts=new Map(),outlineNavigations=new Map();
  const captures=new Map();
  const send=value=>{if(!disposed)frame.contentWindow?.postMessage({...value,channel:'quizforge-host',session},'*');};
  function listener(event){const value=event.data;if(disposed||event.source!==frame.contentWindow||value?.channel!=='quizforge-extension'||value.session!==session)return;
    if(value.kind==='registered'){if(!readyDone){readyDone=true;clearTimeout(readyTimer);resolveReady();if(answerAreasSupported&&answerViewport?.qfAnswerAreaTools)send({kind:'answer-area-tooling',tools:answerViewport.qfAnswerAreaTools});}}
    else if(value.kind==='resize'&&Number.isFinite(value.height)&&!expanded){normalHeight=`${Math.max(100,Math.min(answerAreasSupported?20000:10000,value.height))}px`;if(frame.style.height!==normalHeight)frame.style.height=normalHeight;}
    else if(value.kind==='error'){faulted=true;const message=String(value.message||'题型页面运行失败').slice(0,1000);if(!readyDone){readyDone=true;clearTimeout(readyTimer);rejectReady(new Error(message));}onError?.(message);}
    else if(value.kind==='flushed'){const item=flushes.get(value.id);if(item){clearTimeout(item.timer);flushes.delete(value.id);if(value.ok===false)item.reject(new Error(value.error?.message||'保存未完成'));else item.resolve();}}
    else if(value.kind==='editor-draft'){const item=drafts.get(value.id);if(item){clearTimeout(item.timer);drafts.delete(value.id);if(value.ok){dirty=!!value.changed;item.resolve({draft:value.draft,changed:dirty,supported:!!value.supported});}else item.reject(new Error(value.error?.message||'编辑草稿读取失败'));}}
    else if(value.kind==='document'){const item=documents.get(value.id);if(item){clearTimeout(item.timer);documents.delete(value.id);if(value.ok){dirty=!!value.changed;item.resolve({document:value.document,changed:!!value.changed});}else item.reject(Object.assign(new Error(value.error?.message||'题目内容不完整'),{code:value.error?.code||'INVALID_DOCUMENT'}));}}
    else if(value.kind==='outline-navigated'){const item=outlineNavigations.get(value.id);if(item){clearTimeout(item.timer);outlineNavigations.delete(value.id);if(value.ok===true)item.resolve();else item.reject(Object.assign(new Error(value.error?.message||'子题定位失败，请重试'),{code:value.error?.code||'OUTLINE_NAVIGATION_FAILED'}));}}
    else if(value.kind==='captured-region'){const item=captures.get(value.id);if(item){clearTimeout(item.timer);captures.delete(value.id);if(value.ok===true&&typeof value.html==='string'&&value.html.length<=8000000&&Number.isFinite(value.width)&&value.width>0&&value.width<=10000&&Number.isFinite(value.height)&&value.height>=0&&value.height<=20000)item.resolve({html:value.html,width:value.width,height:value.height});else item.reject(new Error(String(value.error||'题目内容截图失败').slice(0,200)));}}
    else if(value.kind==='interactive-regions'){
      // Geometry only: the draft hand tool leaves these frame areas to the page.
      const valid=Array.isArray(value.rects)&&value.rects.length<=600&&value.rects.every(rect=>Array.isArray(rect)&&rect.length===4&&rect.every(Number.isFinite)&&rect[2]>=0&&rect[3]>=0&&Math.abs(rect[0])<=20000&&Math.abs(rect[1])<=20000&&rect[2]<=20000&&rect[3]<=20000);
      if(valid){frame.qfInteractiveRegions=value.rects.map(rect=>[...rect]);frame.dispatchEvent?.(new (frame.ownerDocument?.defaultView?.CustomEvent||CustomEvent)('qf-interactive-regions',{bubbles:true}));}
    }
    else if(value.kind==='answer-area-regions'&&answerAreasSupported){
      const valid=Array.isArray(value.rects)&&value.rects.length<=16&&value.rects.every(rect=>Array.isArray(rect)&&rect.length===4&&rect.every(Number.isFinite)&&rect[0]>=0&&rect[1]>=0&&rect[2]>=0&&rect[3]>=0&&rect[0]+rect[2]<=10000&&rect[1]+rect[3]<=20000);
      if(valid){frame.qfAnswerAreaRegions=value.rects.map(rect=>[...rect]);frame.dispatchEvent?.(new (frame.ownerDocument?.defaultView?.CustomEvent||CustomEvent)('qf-interactive-regions',{bubbles:true}));}
    }
    else if(value.kind==='answer-area-layout'&&answerAreasSupported&&['1.3.0','1.3.1','1.3.2','1.4.0','1.4.1'].includes(assets.answerAreaComponent.version)){
      const valid=Array.isArray(value.areas)&&value.areas.length<=16&&new Set(value.areas.map(area=>area?.id)).size===value.areas.length&&JSON.stringify(value.areas).length<=8000000&&value.areas.every(area=>typeof area?.id==='string'&&/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(area.id)&&area.document?.id===area.id&&Array.isArray(area.rect)&&area.rect.length===4&&area.rect.every(n=>Number.isFinite(n)&&Math.abs(n)<=20000)&&area.rect[2]>=0&&area.rect[3]>=0&&typeof area.writable==='boolean'&&typeof area.displayInk==='boolean'&&(area.imagePreview===undefined||typeof area.imagePreview==='boolean')&&(area.imageControls===undefined||Array.isArray(area.imageControls)&&area.imageControls.length<=8&&area.imageControls.every(rect=>Array.isArray(rect)&&rect.length===4&&rect.every(n=>Number.isFinite(n)&&Math.abs(n)<=20000)&&rect[2]>=0&&rect[3]>=0)));
      if(!valid)return;
      frame.qfSharedAnswerAreas=value.areas.map(area=>({...area,writable:area.writable&&viewContext.capabilities?.canSave===true}));
      const Event=hostDocument.defaultView?.CustomEvent;if(Event&&answerViewport)answerViewport.dispatchEvent(new Event('qf-shared-answer-layout'));
    }
    else if(value.kind==='request'&&value.method==='answer-area-sync'&&answerAreasSupported&&['1.3.0','1.3.1','1.3.2','1.4.0','1.4.1'].includes(assets.answerAreaComponent.version)&&typeof value.id==='string'){
      const Event=hostDocument.defaultView?.CustomEvent;if(Event&&answerViewport)answerViewport.dispatchEvent(new Event('qf-answer-ink-sync'));
      send({kind:'reply',id:value.id,reply:{ok:true,data:{status:'synced'}}});
    }
    else if(value.kind==='answer-area-focus'&&answerAreasSupported){
      const next=value.focus;
      if(next!==null&&(!next||!/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(next.id)||['writable','canUndo','canRedo'].some(key=>typeof next[key]!=='boolean')))return;
      frame.qfAnswerAreaFocus=next?{id:next.id,writable:next.writable,canUndo:next.canUndo,canRedo:next.canRedo}:null;
      const Event=hostDocument.defaultView?.CustomEvent;if(Event&&answerViewport)answerViewport.dispatchEvent(new Event('qf-answer-area-focus'));
    }
    else if(value.kind==='answer-area-pan'&&answerAreasSupported){
      const p=value.pointer,canvas=answerViewport?.querySelector('.qf-whiteboard-ink'),Event=hostDocument.defaultView?.PointerEvent;
      if(!p||!canvas||!Event||!['pointerdown','pointermove','pointerup','pointercancel'].includes(p.phase)||!['mouse','touch'].includes(p.pointerType)||!Number.isSafeInteger(p.pointerId)||p.pointerId<0||p.pointerId>1000000000||![p.x,p.y].every(n=>Number.isFinite(n)&&Math.abs(n)<=20000))return;
      const rect=frame.getBoundingClientRect(),pointer=new Event(p.phase,{bubbles:true,cancelable:true,pointerId:p.pointerId,pointerType:p.pointerType,button:0,buttons:p.phase==='pointerup'?0:1,clientX:rect.left+p.x*rect.width/(frame.clientWidth||rect.width||1),clientY:rect.top+p.y*rect.height/(frame.clientHeight||rect.height||1)});
      Object.defineProperty(pointer,'qfAnswerPan',{value:true});canvas.dispatchEvent(pointer);
    }
    else if(value.kind==='editor-dirty'){dirty=!!value.changed;onDirty?.(dirty);}
    else if(value.kind==='input-dirty'){inputDirty=!!value.changed;}
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
    else if(value.kind==='request'&&typeof value.id==='string'&&['save','answer-state','action','resource-put','resource-get','sdk-editor','ai-grade','ai-task','ai-retry','ai-confirm'].includes(value.method)){
      Promise.resolve().then(()=>onRequest(value.method,value.args)).then(reply=>{send({kind:'reply',id:value.id,reply});if(reply?.ok===false&&['save','action','ai-grade','ai-retry','ai-confirm'].includes(value.method))onError?.(reply.error?.message||'操作未完成，当前输入仍保留');}).catch(error=>{send({kind:'reply',id:value.id,reply:{ok:false,error:{code:error.code||'HOST_ERROR',message:error.message}}});onError?.(error.message);});
    }
  }
  window.addEventListener('message',listener);container.append(frame);
  const appearanceWatchers=[];
  if(answerAreasSupported){
    const ink=event=>{if(['1.3.0','1.3.1','1.3.2','1.4.0','1.4.1'].includes(assets.answerAreaComponent.version)&&viewContext.capabilities?.canSave===true)send({kind:'answer-area-ink',value:event.detail});};
    frame.addEventListener('qf-answer-ink',ink);appearanceWatchers.push(()=>frame.removeEventListener('qf-answer-ink',ink));
    const tooling=()=>send({kind:'answer-area-tooling',tools:answerViewport.qfAnswerAreaTools});
    const command=event=>{const value=event.detail;if(value&&['undo','redo','clear','deactivate','select-image','deactivate-image'].includes(value.action)&&typeof value.id==='string'&&(value.imageId===undefined||typeof value.imageId==='string'&&/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(value.imageId)))send({kind:'answer-area-command',id:value.id,action:value.action,imageId:value.imageId});};
    if(answerViewport){answerViewport.addEventListener('qf-draft-tools-change',tooling);appearanceWatchers.push(()=>answerViewport.removeEventListener('qf-draft-tools-change',tooling));}
    const dismissImage=()=>{for(const area of frame.qfSharedAnswerAreas||[])if(area.selectedImageId)send({kind:'answer-area-command',id:area.id,action:'deactivate-image'});};
    hostDocument.addEventListener('pointerdown',dismissImage,true);appearanceWatchers.push(()=>hostDocument.removeEventListener('pointerdown',dismissImage,true));
    frame.addEventListener('qf-answer-area-command',command);appearanceWatchers.push(()=>frame.removeEventListener('qf-answer-area-command',command));
    const pane=container.closest?.('.question-pane'),Observer=hostDocument.defaultView?.MutationObserver;
    if(pane&&Observer){const observer=new Observer(()=>send({kind:'answer-area-mode',draft:pane.classList.contains('is-draft')}));observer.observe(pane,{attributes:true,attributeFilter:['class']});appearanceWatchers.push(()=>observer.disconnect());}
  }
  if(appearanceSupported){
    const refresh=()=>{const next=currentAppearance();if(next.theme===appearance.theme&&next.transparency===appearance.transparency)return;appearance=next;send({kind:'appearance',appearance});};
    const Observer=hostDocument.defaultView?.MutationObserver;
    if(Observer){
      const root=new Observer(refresh);root.observe(hostDocument.documentElement,{attributes:true,attributeFilter:['data-qf-theme','style']});appearanceWatchers.push(()=>root.disconnect());
      const pane=container.closest?.('.question-pane');if(pane){const draft=new Observer(refresh);draft.observe(pane,{attributes:true,attributeFilter:['class']});appearanceWatchers.push(()=>draft.disconnect());}
    }
    if(phoneLayout?.addEventListener){phoneLayout.addEventListener('change',refresh);appearanceWatchers.push(()=>phoneLayout.removeEventListener('change',refresh));}
  }
  return {
    frame,ready,get isDirty(){return dirty;},get hasUnsavedInput(){return inputDirty;},get hasError(){return faulted;},setActive(active){send({kind:'visibility',active:!!active});},update(next){viewContext=next;dirty=false;send({kind:'context',context:next});},
    async captureRegion(region){if(disposed)throw new Error('题目页面已关闭');await ready;if(disposed)throw new Error('题目页面已关闭');const id=makeRequestId();return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{captures.delete(id);reject(new Error('截图等待超时，请重试'));},20000);captures.set(id,{resolve,reject,timer});send({kind:'capture-region',id,region});});},
    async navigateOutline(itemId){
      const closedError=()=>Object.assign(new Error('题目页面已关闭'),{code:'PAGE_CLOSED'});
      if(disposed)throw closedError();
      if(typeof itemId!=='string'||!itemId.length||itemId.length>128||itemId!==itemId.trim()||/[\u0000-\u001f\u007f-\u009f<>]/.test(itemId))throw Object.assign(new Error('子题编号无效'),{code:'INVALID_OUTLINE_ITEM'});
      try{await ready;}catch(error){if(disposed)throw closedError();throw error;}
      if(disposed)throw closedError();
      if(!bridge.api.capabilities.includes('outline-items'))throw Object.assign(new Error('这个题型页面尚未支持子题定位'),{code:'OUTLINE_UNAVAILABLE'});
      const id=makeRequestId();return new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>{outlineNavigations.delete(id);reject(Object.assign(new Error('子题定位等待超时，请重试'),{code:'OUTLINE_TIMEOUT'}));},10000);
        outlineNavigations.set(id,{resolve,reject,timer});send({kind:'outline-navigate',id,itemId});
      });
    },
    getDocument({checkOnly=false}={}){if(disposed)return Promise.reject(new Error('编辑页面已关闭'));const id=makeRequestId();return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{documents.delete(id);reject(new Error('编辑页面读取超时，当前修改仍保留'));},10000);documents.set(id,{resolve,reject,timer});send({kind:'read-document',id,checkOnly});});},
    exportDraft(){if(disposed)return Promise.reject(new Error('编辑页面已关闭'));const id=makeRequestId();return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{drafts.delete(id);reject(new Error('编辑草稿读取超时，当前输入仍保留'));},16000);drafts.set(id,{resolve,reject,timer});send({kind:'read-draft',id});});},
    flush(){if(disposed||faulted&&!readyDone)return Promise.resolve();const id=makeRequestId();return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{flushes.delete(id);reject(new Error('题型页面仍在保存，请稍后重试'));},16000);flushes.set(id,{resolve,reject,timer});send({kind:'flush',id});});},
    destroy(){if(disposed)return;send({kind:'dispose'});disposed=true;frame.qfSharedAnswerAreas=null;const SharedEvent=hostDocument.defaultView?.CustomEvent;if(SharedEvent&&answerViewport)answerViewport.dispatchEvent(new SharedEvent('qf-shared-answer-layout'));if(expanded){expanded=false;try{onLayout?.({expanded:false},frame);}catch{}}clearTimeout(readyTimer);rejectReady(new Error('题型页面已关闭'));window.removeEventListener('message',listener);appearanceWatchers.forEach(stop=>stop());for(const item of flushes.values()){clearTimeout(item.timer);item.resolve();}flushes.clear();for(const map of [documents,drafts,captures]){for(const item of map.values()){clearTimeout(item.timer);item.reject(new Error('编辑页面已关闭'));}map.clear();}for(const item of outlineNavigations.values()){clearTimeout(item.timer);item.reject(Object.assign(new Error('题目页面已关闭'),{code:'PAGE_CLOSED'}));}outlineNavigations.clear();frame.remove();}
  };
}
