const STORAGE_KEY='quizforge-outline-width';
const MIN_WIDTH=220,MAX_WIDTH=600,MIN_MAIN_WIDTH=320;

export function outlineWidthBounds(viewportWidth,libraryWidth=0){
  return {min:MIN_WIDTH,max:Math.max(MIN_WIDTH,Math.min(MAX_WIDTH,viewportWidth-libraryWidth-MIN_MAIN_WIDTH))};
}

export function bindOutlineResize({shell,outline,handle,window:win=window}){
  const document=outline.ownerDocument,library=shell.querySelector('.library');
  let preferredWidth=null,drag=null,shield=null;
  try{
    const saved=win.localStorage.getItem(STORAGE_KEY),value=Number(saved);
    if(saved!==null&&Number.isFinite(value)&&value>=MIN_WIDTH&&value<=MAX_WIDTH)preferredWidth=value;
  }catch{}
  const enabled=()=>win.innerWidth>1100&&!outline.hidden&&!shell.classList.contains('outline-hidden')&&!shell.classList.contains('draft-fullscreen');
  function bounds(){
    const left=library&&!library.hidden&&!shell.classList.contains('library-hidden')?library.getBoundingClientRect().width:0;
    return outlineWidthBounds(shell.getBoundingClientRect().width||win.innerWidth,left);
  }
  function currentWidth(){return outline.getBoundingClientRect().width||340;}
  function sync(){
    if(!enabled()){
      if(drag)finish(false);
      handle.hidden=true;return;
    }
    handle.hidden=false;
    const {min,max}=bounds();
    if(preferredWidth!==null){
      const value=`${Math.round(Math.max(min,Math.min(max,preferredWidth)))}px`;
      if(shell.style.getPropertyValue('--outline-width')!==value)shell.style.setProperty('--outline-width',value);
    }else shell.style.removeProperty('--outline-width');
    handle.setAttribute('aria-valuemin',String(min));handle.setAttribute('aria-valuemax',String(max));
    handle.setAttribute('aria-valuenow',String(Math.round(currentWidth())));
  }
  function setWidth(width){const {min,max}=bounds();preferredWidth=Math.round(Math.max(min,Math.min(max,width)));sync();}
  function persist(){
    try{if(preferredWidth===null)win.localStorage.removeItem(STORAGE_KEY);else win.localStorage.setItem(STORAGE_KEY,String(preferredWidth));}catch{}
  }
  function finish(save=true){
    if(!drag)return;
    const previous=drag;drag=null;
    if(!save)preferredWidth=previous.previousWidth;
    if(handle.hasPointerCapture?.(previous.pointerId))handle.releasePointerCapture(previous.pointerId);
    shield?.remove();shield=null;shell.classList.remove('outline-resizing');
    sync();if(save)persist();
  }
  function pointerDown(event){
    if(!enabled()||drag||event.button!==0||event.isPrimary===false)return;
    event.preventDefault();
    drag={pointerId:event.pointerId,startX:event.clientX,startWidth:currentWidth(),previousWidth:preferredWidth};
    shield=document.createElement('div');shield.className='outline-resize-shield';shield.setAttribute('aria-hidden','true');document.body.append(shield);
    shell.classList.add('outline-resizing');handle.focus({preventScroll:true});
    try{handle.setPointerCapture?.(event.pointerId);}catch{}
  }
  function pointerMove(event){
    if(!drag||event.pointerId!==drag.pointerId)return;
    if(!enabled()){finish(false);return;}
    event.preventDefault();setWidth(drag.startWidth+drag.startX-event.clientX);
  }
  function pointerUp(event){if(drag&&event.pointerId===drag.pointerId)finish();}
  function pointerCancel(event){if(drag&&event.pointerId===drag.pointerId)finish(false);}
  function reset(){if(!enabled())return;finish(false);preferredWidth=null;sync();persist();}
  function keyDown(event){
    if(!enabled())return;
    if(event.key==='Escape'&&drag){event.preventDefault();finish(false);return;}
    const step=event.shiftKey?32:16,{min,max}=bounds();
    const value=event.key==='ArrowLeft'?currentWidth()+step:event.key==='ArrowRight'?currentWidth()-step:
      event.key==='Home'?min:event.key==='End'?max:null;
    if(value===null)return;event.preventDefault();setWidth(value);persist();
  }
  const lostCapture=()=>finish(),blur=()=>finish();
  const listeners=[[handle,'pointerdown',pointerDown],[win,'pointermove',pointerMove],[win,'pointerup',pointerUp],
    [win,'pointercancel',pointerCancel],[handle,'lostpointercapture',lostCapture],[win,'blur',blur],
    [handle,'dblclick',reset],[handle,'keydown',keyDown],[win,'resize',sync]];
  for(const [target,type,listener]of listeners)target.addEventListener(type,listener);
  const observer=new win.MutationObserver(sync);
  observer.observe(shell,{attributes:true,attributeFilter:['class']});
  observer.observe(outline,{attributes:true,attributeFilter:['hidden']});
  if(library)observer.observe(library,{attributes:true,attributeFilter:['hidden']});
  const sizes=win.ResizeObserver?new win.ResizeObserver(sync):null;
  sizes?.observe(shell);if(library)sizes?.observe(library);
  sync();
  return {destroy(){finish(false);observer.disconnect();sizes?.disconnect();for(const [target,type,listener]of listeners)target.removeEventListener(type,listener);}};
}
