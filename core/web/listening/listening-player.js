import {clampPosition,fitWidth,DEFAULT_WIDTH} from './geometry.js';
import {createPlayerDrag} from './player-drag.js';
import {dockedPosition,TOOLBAR_ANCHORS} from '../draft/whiteboard-dock.js';

// One host-owned player. Question iframes never receive paths or network access.
export function createListeningPlayer({document,request,createPlayer,storage=document.defaultView.localStorage,URL=document.defaultView.URL}){
  const window=document.defaultView,root=document.createElement('section');root.className='qf-listening';root.hidden=true;root.setAttribute('aria-label','悬浮听力播放器');
  const icon=(path,extra='')=>`<svg viewBox="0 0 24 24" aria-hidden="true" ${extra}>${path}</svg>`;
  const playIcon=icon('<path class="qfl-play-icon" d="M8 5v14l11-7Z"/><path class="qfl-pause-icon" d="M7 5h4v14H7zm6 0h4v14h-4z"/>');
  root.innerHTML=`<div class="qfl-content"><div class="qfl-expanded"><header class="qfl-head" tabindex="0" aria-label="拖动听力播放器"><span class="qfl-grip" aria-hidden="true">⠿</span><button class="qfl-material" type="button" aria-label="选择听力材料" aria-haspopup="listbox" aria-expanded="false"><span><small class="qfl-kicker"></small><strong class="qfl-title"></strong></span>${icon('<path d="m7 10 5 5 5-5"/>')}</button><button class="qfl-collapse qfl-icon" type="button" aria-label="最小化听力播放器">${icon('<path d="M6 12h12"/>')}</button></header><ul class="qfl-menu qfl-material-menu" role="listbox" aria-label="听力材料" hidden></ul><div class="qfl-player"></div><p class="qfl-status" role="status" hidden></p><button class="qfl-retry" type="button" hidden>重新读取材料</button></div><div class="qfl-compact"><button class="qfl-toggle" type="button" aria-label="播放音频"><svg class="qfl-ring" viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="18"/><circle class="qfl-ring-progress" cx="20" cy="20" r="18" pathLength="100"/></svg>${playIcon}</button><div class="qfl-mini-info" tabindex="0" aria-label="拖动听力播放器"><strong></strong><span></span></div><button class="qfl-expand qfl-icon" type="button" aria-label="展开听力播放器">${icon('<path d="M14 4h6v6M10 20H4v-6M20 4l-6 6M4 20l6-6"/>')}</button></div></div><span class="qfl-resize" tabindex="0" role="slider" aria-label="调整听力播放器宽度" aria-valuemin="300" aria-valuemax="560" aria-valuenow="360" title="左右拖动调整宽度，双击恢复默认"></span>`;
  root.insertAdjacentHTML('beforeend',`<div class="qfl-drag-ball" aria-hidden="true">${icon('<path d="M4 14v-3a8 8 0 0 1 16 0v3M4 12H3v7h4v-7H4zm16 0h1v7h-4v-7h3z"/>')}</div>`);
  const $=selector=>root.querySelector(selector),content=$('.qfl-content'),handle=$('.qfl-head'),miniHandle=$('.qfl-mini-info'),resize=$('.qfl-resize'),materialButton=$('.qfl-material'),materialMenu=$('.qfl-material-menu'),status=$('.qfl-status');
  const player=(createPlayer||window.QFAudioPlayer.create)($('.qfl-player'),{badge:null,exclusive:true,ariaLabel:'公共听力播放器'});
  // Reuse the real player's controls and their existing event handlers.
  const transport=$('.qfa-transport');
  let speedButton=null,speedMenu=null;
  if(transport){
    const main=document.createElement('div');main.className='qfl-main';
    const row=document.createElement('div');row.className='qfl-row';
    const tools=document.createElement('div');tools.className='qfl-tools';
    main.append($('.qfa-track'),row);row.append($('.qfa-time'),tools);tools.append($('.qfa-back'),$('.qfa-forward'));
    const speed=document.createElement('div');speed.className='qfl-speed';
    speed.innerHTML='<button class="qfl-speed-button" type="button" aria-label="播放倍速" aria-haspopup="menu" aria-expanded="false">1×</button><ul class="qfl-menu qfl-speed-menu" role="menu" aria-label="播放倍速" hidden></ul>';
    tools.append(speed);transport.append(main);speedButton=$('.qfl-speed-button');speedMenu=$('.qfl-speed-menu');
    for(const rate of [.75,1,1.25,1.5,2]){
      const item=document.createElement('li'),button=document.createElement('button');button.type='button';button.textContent=`${rate}×`;button.setAttribute('role','menuitemradio');button.dataset.rate=String(rate);
      button.addEventListener('click',()=>{player.setSpeed(rate);closeMenus();speedButton.focus();});item.append(button);speedMenu.append(item);
    }
  }
  let pane=null,scope=null,questionId=null,selected=null,config=null,exam=false,collapsed=window.matchMedia('(max-width:600px)').matches,examStarted=false,ordinaryExpanded=false,destroyed=false,position=null,width=DEFAULT_WIDTH,geometry=null,motion=null,anchor=null,resizing=null,observer=null,abort=null,generation=0,pendingSeek=0,loading=false,loadedKey=null,objectUrl=null,error=null;
  const progress=new Map(),blobs=new Map(),geometries=new Map();
  try{const value=JSON.parse(storage.getItem('quizforge-listening-geometry-v2'));if(value?.position&&Number.isFinite(value.position.x)&&Number.isFinite(value.position.y))position=value.position;if(Number.isFinite(value?.width))width=value.width;if(TOOLBAR_ANCHORS.includes(value?.anchor))anchor=value.anchor;}catch{}
  function remember(){if(scope&&selected&&loadedKey)progress.set(`${scope}:${selected}`,player.getCurrentTime());}
  function cancel(){generation++;abort?.abort();abort=null;loading=false;}
  function save(){if(scope)geometries.set(scope,{position,width,anchor});try{storage.setItem('quizforge-listening-geometry-v2',JSON.stringify({position,width,anchor}));}catch{}}
  function release(){player.pause();player.setSource('');loadedKey=null;if(objectUrl)URL.revokeObjectURL(objectUrl);objectUrl=null;}
  function area(){return {width:pane?.viewport.clientWidth||1,height:pane?.viewport.clientHeight||1};}
  function place(next=position){
    if(root.hidden||!pane||motion?.dragging)return;
    const bounds=area(),compact=root.dataset.compact==='true';
    const fitted=fitWidth(width,bounds),cardWidth=compact?Math.min(282,Math.max(1,bounds.width-16)):fitted.width;
    root.style.width=`${cardWidth}px`;content.style.width='100%';
    geometry={...fitted,width:cardWidth,height:content.offsetHeight};
    if(anchor&&!arguments.length){
      const viewport=pane.viewport.getBoundingClientRect();
      const obstacles=[...document.querySelectorAll('#previous,#next')].map(node=>{const r=node.getBoundingClientRect();return {left:r.left-viewport.left,top:r.top-viewport.top,width:r.width,height:r.height};}).filter(row=>row.width&&row.height);
      const docked=dockedPosition({anchor},bounds,geometry,obstacles,{open:true});next={x:docked.left,y:docked.top};
    }
    position=clampPosition(next||{x:bounds.width-cardWidth-16,y:16},geometry,bounds);
    const viewport=pane.viewport.getBoundingClientRect(),parent=pane.node.getBoundingClientRect();
    root.style.left=`${viewport.left-parent.left+position.x}px`;root.style.top=`${viewport.top-parent.top+position.y}px`;
    resize.hidden=compact;resize.setAttribute('aria-valuemin',String(fitted.minWidth));resize.setAttribute('aria-valuemax',String(fitted.maxWidth));resize.setAttribute('aria-valuenow',String(Math.round(fitted.width)));resize.setAttribute('aria-valuetext',`宽度 ${Math.round(fitted.width)} 像素`);
    positionMenu(materialMenu);positionMenu(speedMenu);
  }
  function closeMenus(){for(const [button,menu] of [[materialButton,materialMenu],[speedButton,speedMenu]])if(menu){menu.hidden=true;button.setAttribute('aria-expanded','false');}}
  function positionMenu(menu){
    if(!menu||menu.hidden||!pane)return;
    menu.style.translate='';menu.style.maxHeight=`${Math.max(32,Math.min(280,pane.viewport.clientHeight-16))}px`;
    menu.classList.remove('qfl-menu-up');
    const bounds=pane.viewport.getBoundingClientRect();
    if(menu.getBoundingClientRect().bottom>bounds.bottom-8)menu.classList.add('qfl-menu-up');
    const rect=menu.getBoundingClientRect(),available=Math.max(32,Math.min(280,bounds.height-16));
    menu.style.maxHeight=`${available}px`;
    // Menus are part of the preview overlay, including at its top and bottom edges.
    menu.style.translate=`0 ${Math.max(0,bounds.top+8-rect.top)-Math.max(0,rect.bottom-bounds.bottom+8)}px`;
  }
  function toggleMenu(button,menu){
    const open=menu.hidden;closeMenus();if(!open)return;
    menu.hidden=false;menu.style.translate='';button.setAttribute('aria-expanded','true');positionMenu(menu);
  }
  function updateMaterialMenu(){
    const materials=config?.materials||[],current=materials.findIndex(row=>row.id===selected);
    $('.qfl-kicker').textContent=`听力材料 ${current+1} / ${materials.length}`;
    $('.qfl-title').textContent=materials[current]?.title||'听力材料';
    materialMenu.replaceChildren(...materials.map(row=>{
      const item=document.createElement('li'),button=document.createElement('button'),title=document.createElement('span'),meta=document.createElement('small');
      button.type='button';button.setAttribute('role','option');button.setAttribute('aria-selected',String(row.id===selected));button.dataset.materialId=row.id;
      title.textContent=row.title;meta.textContent=time(row.id===selected?player.getCurrentTime():progress.get(`${scope}:${row.id}`)||0);button.append(title,meta);
      button.addEventListener('click',()=>{closeMenus();void load(row.id);materialButton.focus();});item.append(button);return item;
    }));
  }
  function playing(){
    const value=player.isPlaying(),material=config?.materials.find(row=>row.id===selected);
    $('.qfl-toggle').dataset.playing=String(value);$('.qfl-toggle').setAttribute('aria-label',value?'暂停音频':'播放音频');$('.qfl-toggle').disabled=loading||!!error;
    $('.qfl-mini-info strong').textContent=material?.title||'听力材料';$('.qfl-mini-info span').textContent=loading?'正在读取…':error?'读取失败，展开重试':`${time(player.getCurrentTime())} / ${time(player.getDuration())}`;
    for(const button of root.querySelectorAll('.qfa-toggle,.qfa-back,.qfa-forward'))button.disabled=loading||!!error||!loadedKey;
    status.textContent=error||(loading?'正在读取听力材料…':'');status.hidden=!error&&!loading;$('.qfl-retry').hidden=!error;
    const ratio=player.getDuration()>0?Math.min(1,player.getCurrentTime()/player.getDuration()):0;$('.qfl-ring-progress').style.strokeDashoffset=String(100-ratio*100);
    const current=config?.materials.findIndex(row=>row.id===selected)??-1;$('.qfl-kicker').textContent=`听力材料 ${current+1} / ${config?.materials.length||0}`;$('.qfl-title').textContent=material?.title||'听力材料';
    const active=materialMenu.querySelector('[aria-selected="true"] small');if(active)active.textContent=time(player.getCurrentTime());
    if(speedButton){const rate=player.getSpeed();speedButton.textContent=`${rate}×`;speedButton.dataset.changed=String(rate!==1);for(const button of speedMenu.querySelectorAll('button'))button.setAttribute('aria-checked',String(Number(button.dataset.rate)===rate));}
  }
  function time(value){const seconds=Math.floor(Number.isFinite(value)?value:0);return `${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;}
  function render(){
    const listening=pane?.collection.questions.find(row=>row.id===pane.questionId)?.listening;
    const allowed=pane?.view==='practice'&&!pane.summaryShown&&(!exam||pane.exam?.status==='in-progress')&&!!selected;
    root.hidden=!(allowed&&(listening||exam&&examStarted));root.dataset.compact=String(collapsed||!listening&&!ordinaryExpanded);root.dataset.exam=String(exam);
    if(!allowed||!listening&&!exam)player.pause();
    if(root.hidden)closeMenus();
    playing();place();
  }
  async function load(id,{retry=false}={}){
    if(!config?.materials.some(row=>row.id===id))return;
    const material=config.materials.find(row=>row.id===id),key=`${scope}:${id}:${material.revision}`;
    if(!retry&&selected===id&&(loadedKey===key||loading))return;
    remember();cancel();release();selected=id;error=null;loading=true;const version=generation,owner=pane;
    pendingSeek=progress.get(`${scope}:${id}`)||0;updateMaterialMenu();render();
    const controller=new AbortController();abort=controller;
    try{
      let blob=blobs.get(key);
      if(!blob){blob=await request(`/api/collections/${encodeURIComponent(pane.kind)}/${encodeURIComponent(pane.id)}/listening/${encodeURIComponent(id)}`,{responseType:'blob',headers:{Accept:'audio/*'},signal:controller.signal,timeoutMs:60000});if(blob.size>8*1024*1024||!/^audio\//.test(blob.type))throw new Error('听力材料格式或大小无效。');}
      if(destroyed||version!==generation||owner!==pane)return;
      blobs.delete(key);blobs.set(key,blob);while(blobs.size>2)blobs.delete(blobs.keys().next().value);
      objectUrl=URL.createObjectURL(blob);loadedKey=key;loading=false;player.setSource(objectUrl);player.setSpeed(1);render();
    }catch(e){if(destroyed||version!==generation||controller.signal.aborted)return;loading=false;error=e.message||'听力材料读取失败，请重试。';render();}
    finally{if(abort===controller)abort=null;}
  }
  function setContext(next){
    if(destroyed)return;
    if(!next){motion?.cancel();motion?.stopSettle();if(pane){remember();save();cancel();release();observer?.disconnect();pane=null;scope=null;selected=null;config=null;questionId=null;}root.hidden=true;return;}
    if(next!==pane){motion?.cancel();motion?.stopSettle();remember();save();cancel();release();observer?.disconnect();pane=next;scope=pane?.key||null;questionId=null;selected=null;examStarted=false;config=null;error=null;
      if(!pane){root.hidden=true;return;}pane.node.append(root);const saved=geometries.get(scope);if(saved){position=saved.position;width=saved.width;anchor=saved.anchor;}observer=new window.ResizeObserver(()=>{motion?.cancel();motion?.stopSettle();place();});observer.observe(pane.viewport);
    }
    config=pane.collection.listening;exam=pane.kind==='exam';
    if(!config||pane.view!=='practice'||pane.summaryShown||exam&&pane.exam?.status!=='in-progress'){motion?.cancel();motion?.stopSettle();remember();player.pause();cancel();root.hidden=true;questionId=null;return;}
    const question=pane.collection.questions.find(row=>row.id===pane.questionId),changed=questionId!==pane.questionId;questionId=pane.questionId;if(changed)ordinaryExpanded=false;
    if(!question?.listening&&!exam){remember();player.pause();if(loading){cancel();selected=null;}render();return;}
    const desired=exam?(selected||config.examMaterialId):changed||!selected?question?.listening?.materialId:selected;
    if(!desired){player.pause();selected=null;root.hidden=true;return;}
    void load(desired);render();
  }
  materialButton.addEventListener('click',()=>toggleMenu(materialButton,materialMenu));
  speedButton?.addEventListener('click',()=>toggleMenu(speedButton,speedMenu));
  function outside(event){if(!root.contains(event.target))closeMenus();}
  document.addEventListener('pointerdown',outside);
  root.addEventListener('keydown',event=>{if(event.key==='Escape'){const button=materialMenu.hidden?speedButton:materialButton;closeMenus();button?.focus();}});
  $('.qfl-collapse').addEventListener('click',()=>{collapsed=true;closeMenus();render();save();});$('.qfl-expand').addEventListener('click',()=>{collapsed=false;ordinaryExpanded=true;closeMenus();render();save();});
  $('.qfl-toggle').addEventListener('click',()=>{if(!loading)void player.toggle().catch(e=>{error=e.message;render();});});$('.qfl-retry').addEventListener('click',()=>void load(selected,{retry:true}));
  for(const event of ['play','pause','ended','statechange','ratechange'])player.on(event,()=>{if(destroyed)return;if(exam&&event==='play')examStarted=true;render();});
  player.on('timeupdate',playing);player.audio.addEventListener('loadedmetadata',()=>{if(pendingSeek){player.seekTo(Math.min(pendingSeek,player.getDuration()));pendingSeek=0;}playing();});
  player.on('error',()=>{if(!loading){error='听力材料无法播放，请重新读取或检查音频格式。';render();}});
  function shield(enabled){if(pane)pane.node.classList.toggle('listening-interacting',enabled);}
  motion=createPlayerDrag({
    element:root,
    area(){const rect=pane.viewport.getBoundingClientRect();return {left:rect.left,top:rect.top,...area()};},
    box(){const viewport=pane.viewport.getBoundingClientRect(),rect=root.getBoundingClientRect();return {left:rect.left-viewport.left,top:rect.top-viewport.top,width:rect.width,height:rect.height};},
    drawBall(ball){const viewport=pane.viewport.getBoundingClientRect(),parent=pane.node.getBoundingClientRect();root.style.width='44px';root.style.height='44px';root.style.left=`${viewport.left-parent.left+ball.left}px`;root.style.top=`${viewport.top-parent.top+ball.top}px`;},
    restore(dock){if(dock)anchor=dock.anchor;place();},interact:shield,closeMenus,save
  });
  for(const target of [handle,miniHandle])target.addEventListener('keydown',event=>{
    if(!event.altKey||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;
    event.preventDefault();motion.stopSettle();anchor=null;place({x:position.x+(event.key==='ArrowRight'?20:event.key==='ArrowLeft'?-20:0),y:position.y+(event.key==='ArrowDown'?20:event.key==='ArrowUp'?-20:0)});save();
  });
  resize.addEventListener('pointerdown',event=>{
    if(event.button!==0||root.dataset.compact==='true')return;
    motion.stopSettle();resizing={id:event.pointerId,x:event.clientX,width:geometry.width,left:position.x};resize.setPointerCapture(event.pointerId);shield(true);closeMenus();event.preventDefault();
  });
  resize.addEventListener('pointermove',event=>{
    if(resizing?.id!==event.pointerId)return;
    const available={...area(),width:area().width-resizing.left+8};
    width=fitWidth(resizing.width+event.clientX-resizing.x,available).width;place();
  });
  function finish(event){
    if(resizing?.id===event.pointerId)resizing=null;
    shield(false);save();
  }
  for(const target of [resize])for(const event of ['pointerup','pointercancel','lostpointercapture'])target.addEventListener(event,finish);
  resize.addEventListener('dblclick',()=>{width=DEFAULT_WIDTH;place();save();});
  resize.addEventListener('keydown',event=>{
    if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
    event.preventDefault();const bounds=fitWidth(width,area());width=event.key==='Home'?bounds.minWidth:event.key==='End'?bounds.maxWidth:bounds.width+(event.key==='ArrowRight'?20:-20);place();save();
  });
  return {setContext,destroy(){if(destroyed)return;motion?.destroy();remember();save();cancel();destroyed=true;document.removeEventListener('pointerdown',outside);observer?.disconnect();shield(false);player.pause();player.destroy();if(objectUrl)URL.revokeObjectURL(objectUrl);blobs.clear();root.remove();}};
}
