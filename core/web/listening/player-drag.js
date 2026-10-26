import {isToolbarDrag, releaseVelocity, releaseDock, springStep, springSettled, TOOLBAR_SHRINK_MS, TOOLBAR_SHAPE_SPRING} from '../draft/whiteboard-dock.js';

// The same pointer threshold, frame-only movement, shrink and release spring as
// the draft toolbar. The player keeps its own layout and playback controls.
export function createPlayerDrag({element, area, box, drawBall, restore, interact, closeMenus, save}) {
  const win=element.ownerDocument.defaultView;
  let drag=null,settle=null,suppressUntil=0,destroyed=false;
  const reduced=()=>!!win.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const now=()=>win.performance.now();
  const transform=(x,y,sx=1,sy=1)=>`translate3d(${x}px, ${y}px, 0) scale(${sx}, ${sy})`;
  function stopSettle(){
    if(settle)win.cancelAnimationFrame(settle.frame);
    settle=null;delete element.dataset.settling;element.style.removeProperty('transform');
  }
  function springFrom(from,velocity={x:0,y:0}){
    stopSettle();const to=box();
    if(reduced()||!from||!to.width||!to.height||element.hidden)return;
    const channels={
      x:{value:from.left+from.width/2-to.left-to.width/2,velocity:velocity.x*1000},
      y:{value:from.top+from.height/2-to.top-to.height/2,velocity:velocity.y*1000},
      sx:{value:(from.width/to.width-1)*100,velocity:0},sy:{value:(from.height/to.height-1)*100,velocity:0}
    };
    element.dataset.settling='true';settle={frame:0,time:null};
    const write=()=>{element.style.transform=transform(channels.x.value,channels.y.value,1+channels.sx.value/100,1+channels.sy.value/100);};
    function step(time){
      if(!settle||destroyed)return;
      const elapsed=settle.time===null?16:time-settle.time;settle.time=time;
      let done=true;
      for(const key of Object.keys(channels)){
        channels[key]=springStep(channels[key],elapsed,key.startsWith('s')?TOOLBAR_SHAPE_SPRING:undefined);
        done=done&&springSettled(channels[key]);
      }
      if(done){stopSettle();return;}write();settle.frame=win.requestAnimationFrame(step);
    }
    write();settle.frame=win.requestAnimationFrame(step);
  }
  function visual(d){
    const t=d.shrink?Math.min(1,(now()-d.shrink.start)/TOOLBAR_SHRINK_MS):1,rest=(1-t)**3;
    return {x:d.offset.x+(d.shrink?.dx||0)*rest,y:d.offset.y+(d.shrink?.dy||0)*rest,
      sx:1+((d.shrink?.sx||1)-1)*rest,sy:1+((d.shrink?.sy||1)-1)*rest,done:t>=1};
  }
  function offset(d){
    const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
    d.offset={x:clamp(d.pointer.x-d.x,d.minX,d.maxX),y:clamp(d.pointer.y-d.y,d.minY,d.maxY)};
  }
  function frame(){
    const d=drag;if(!d?.moved)return;d.frame=0;offset(d);
    const v=visual(d);element.style.transform=transform(v.x,v.y,v.sx,v.sy);
    if(!v.done)d.frame=win.requestAnimationFrame(frame);
    else {d.shrink=null;delete element.dataset.shrinking;}
  }
  function begin(d){
    const from=box();stopSettle();closeMenus();interact(true);
    d.moved=true;d.area=area();
    // Keep the captured pointer on the root while its pressed button disappears.
    try{element.setPointerCapture(d.id);}catch{}
    element.dataset.dragging='true';
    const size=44,left=d.x-d.area.left-size/2,top=d.y-d.area.top-size/2;
    d.ball={left,top,width:size,height:size};
    d.minX=8-left;d.maxX=Math.max(8,d.area.width-size-8)-left;
    d.minY=8-top;d.maxY=Math.max(8,d.area.height-size-8)-top;
    d.offset={x:0,y:0};drawBall(d.ball);
    if(!reduced()){
      element.dataset.shrinking='true';
      d.shrink={start:now(),dx:from.left+from.width/2-left-size/2,dy:from.top+from.height/2-top-size/2,sx:from.width/size,sy:from.height/size};
    }
  }
  function down(event){
    if(destroyed||element.hidden||drag||event.button!==0||event.isPrimary===false)return;
    if(event.target.closest('.qfa-track,.qfl-resize,.qfl-menu'))return;
    const target=event.target.closest('button')||element;
    drag={id:event.pointerId,x:event.clientX,y:event.clientY,target,moved:false,frame:0,
      pointer:{x:event.clientX,y:event.clientY},samples:[{x:event.clientX,y:event.clientY,t:event.timeStamp}]};
    // A quick move off a small title/button must still reach the player.
    try{target.setPointerCapture(event.pointerId);}catch{}
  }
  function move(event){
    const d=drag;if(d?.id!==event.pointerId)return;
    d.pointer={x:event.clientX,y:event.clientY};d.samples.push({...d.pointer,t:event.timeStamp});if(d.samples.length>12)d.samples.shift();
    if(!d.moved&&!isToolbarDrag(event.clientX-d.x,event.clientY-d.y))return;
    event.preventDefault();if(!d.moved)begin(d);if(!d.frame)d.frame=win.requestAnimationFrame(frame);
  }
  function stop(){
    const d=drag;drag=null;if(!d)return null;
    if(d.frame)win.cancelAnimationFrame(d.frame);
    delete element.dataset.dragging;delete element.dataset.shrinking;element.style.removeProperty('transform');element.style.removeProperty('height');
    try{element.releasePointerCapture(d.id);}catch{}try{d.target.releasePointerCapture(d.id);}catch{}
    if(d.moved)interact(false);return d;
  }
  function drawn(d){
    const v=visual(d),width=d.ball.width*v.sx,height=d.ball.height*v.sy;
    return {left:d.ball.left+v.x+(d.ball.width-width)/2,top:d.ball.top+v.y+(d.ball.height-height)/2,width,height};
  }
  function end(event){
    const d=drag;if(d?.id!==event.pointerId)return;
    if(!d.moved){stop();return;}
    d.pointer={x:event.clientX,y:event.clientY};offset(d);
    const from=drawn(d),velocity=releaseVelocity(d.samples);
    const centre={x:d.ball.left+d.offset.x+22,y:d.ball.top+d.offset.y+22};
    stop();suppressUntil=now()+400;restore(releaseDock(centre,velocity,d.area));springFrom(from,velocity);save();
  }
  function cancel(){
    const d=drag;if(!d)return;const from=d.moved?drawn(d):null;
    stop();if(!d.moved)return;suppressUntil=now()+400;restore();springFrom(from);
  }
  function interrupted(event){if(drag?.id===event.pointerId)cancel();}
  function lost(event){if(event.target===element&&drag?.moved&&drag.id===event.pointerId)cancel();}
  function click(event){if(now()<suppressUntil){event.preventDefault();event.stopImmediatePropagation();}}
  const listeners=[['pointerdown',down],['pointermove',move],['pointerup',end],['pointercancel',interrupted],['lostpointercapture',lost],['click',click,true]];
  for(const [name,fn,capture]of listeners)element.addEventListener(name,fn,capture);
  return {get dragging(){return !!drag?.moved;},cancel,stopSettle,destroy(){cancel();stopSettle();destroyed=true;for(const [name,fn,capture]of listeners)element.removeEventListener(name,fn,capture);}};
}
