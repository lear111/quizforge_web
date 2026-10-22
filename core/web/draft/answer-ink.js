import {answerAreaModel} from '../../shared/answer-area/1.4.0/model.js';
import {paintInkStroke} from '../../shared/ink/1.0.0/renderer.js';
import {canvasSpace} from './canvas-space.js';
const model=answerAreaModel();
const round=value=>Math.round(value*1000)/1000;
export function transformInk(strokes,from,to){
  const scale=to.width/from.width;
  return strokes.map(stroke=>({...stroke,width:round(stroke.width*scale),points:stroke.points.map(point=>({...point,x:round(to.x+(point.x-from.x)*scale),y:round(to.y+(point.y-from.y)*scale)}))}));
}
export function strokeInRectangle(stroke,rect){
  const r=stroke.width/2,left=rect.x-r,right=rect.x+rect.width+r,top=rect.y-r,bottom=rect.y+rect.height+r;
  const segment=(a,b)=>{let min=0,max=1;for(const [p,q]of [[a.x-b.x,a.x-left],[b.x-a.x,right-a.x],[a.y-b.y,a.y-top],[b.y-a.y,bottom-a.y]]){if(p===0){if(q<0)return false;continue;}const t=q/p;if(p<0)min=Math.max(min,t);else max=Math.min(max,t);if(min>max)return false;}return true;};
  const points=stroke.points;if(points.length===1)return segment(points[0],points[0]);
  for(let index=1;index<points.length;index++){
    const previous=points[index-1],current=points[index],from=index===1?previous:{x:(points[index-2].x+previous.x)/2,y:(points[index-2].y+previous.y)/2},to=index===points.length-1?current:{x:(previous.x+current.x)/2,y:(previous.y+current.y)/2};
    let last=from;for(let step=1;step<=12;step++){const t=step/12,next={x:(1-t)**2*from.x+2*(1-t)*t*previous.x+t*t*to.x,y:(1-t)**2*from.y+2*(1-t)*t*previous.y+t*t*to.y};if(segment(last,next))return true;last=next;}
  }return false;
}

export function createAnswerInk({container,canvas,whiteboard,getMode,getCamera,getScroll,getSize,onAdopt}){
  // Strokes the host just removed on purpose (重做); a stale answer document must not bring them back.
  let records=new WeakMap(),forgotten=new Set();
  function collect(){
    const result=[],space=canvasSpace(canvas,getSize?.());
    for(const frame of container.querySelectorAll('iframe')){
      if(frame.closest('.development-preview-candidate,.development-retained-question,.collection-candidate'))continue;
      const bounds=frame.getBoundingClientRect();if(!bounds.width||!bounds.height||!frame.qfSharedAnswerAreas)continue;
      const scale=bounds.width/(frame.clientWidth||frame.offsetWidth||bounds.width);
      const scaleY=frame.clientHeight||frame.offsetHeight?bounds.height/(frame.clientHeight||frame.offsetHeight):scale;
      let byId=records.get(frame);if(!byId){byId=new Map();records.set(frame,byId);}
      for(const input of frame.qfSharedAnswerAreas){
        let document;try{document=model.normalize(input.document);}catch{continue;}
        const [x,y,width,height]=input.rect;if(width<=0||height<=0)continue;
        const screen=space.rect({left:bounds.left+x*scale,top:bounds.top+y*scaleY,width:width*scale,height:height*scaleY});
        let record=byId.get(input.id);if(!record){record={hydrated:false,lastSent:null};byId.set(input.id,record);}
        Object.assign(record,{frame,input,document,screen});result.push(record);
      }
    }return result;
  }
  let syncing=false;
  function sync(){
    if(syncing)return;syncing=true;
    try{
      let adopted=false;const rows=collect();
      // Preview height is temporary; wait for commit before moving scratch ink.
      if(rows.some(row=>row.input.imagePreview===true))return;
      const owners=new Map();for(const row of rows)for(const stroke of row.document.strokes)owners.set(stroke.id,row);
      const camera=getCamera();
      const live=rows.filter(row=>getMode()==='draft'&&row.input.writable&&row.screen.width/camera.zoom>=1&&row.screen.height/camera.zoom>=1);
      for(const record of live){
        const doc=record.document,camera=getCamera(),scroll=getScroll(),screen=record.screen;
        record.nextAnchor={x:round((screen.x+scroll.x)/camera.zoom-camera.x),y:round((screen.y+scroll.y)/camera.zoom-camera.y),width:round(screen.width/camera.zoom),height:round(screen.height/camera.zoom)};
      }
      // Reproject answer-owned strokes as a group when surrounding HTML moves.
      // Their undo snapshots use the same transform, so undo cannot jump back.
      for(const record of live){
        const doc=record.document,anchor=record.nextAnchor,previous=record.anchor||doc.anchor||anchor;
        if(!record.hydrated){
          if(record.input.autoGrow&&doc.anchor&&(doc.anchor.x!==anchor.x||doc.anchor.y!==anchor.y||doc.anchor.width!==anchor.width)){
            const existing=new Set(whiteboard.strokes.map(stroke=>stroke.id)),ids=new Set(doc.strokes.filter(stroke=>existing.has(stroke.id)).map(stroke=>stroke.id));
            whiteboard.mapStrokes(ids,stroke=>transformInk([stroke],doc.anchor,anchor)[0]);adopted=adopted||ids.size>0;
          }
          const imported=transformInk(doc.strokes,{x:0,y:0,width:doc.width,height:doc.height},record.input.autoGrow?anchor:doc.anchor||anchor).map(stroke=>({...stroke,width:Math.max(.5,Math.min(32,stroke.width)),id:doc.inkSource==='draft'?stroke.id:`area-${doc.id.slice(0,24)}-${stroke.id.slice(0,85)}`}));
          const ids=new Set(whiteboard.strokes.map(stroke=>stroke.id)),missing=imported.filter(stroke=>!ids.has(stroke.id)&&!forgotten.has(stroke.id));
          if(missing.length){whiteboard.adoptStrokes([...whiteboard.strokes,...missing]);adopted=true;}
          record.hydrated=true;
        }else if(record.input.autoGrow&&(previous.x!==anchor.x||previous.y!==anchor.y||previous.width!==anchor.width)){
          const ids=new Set(doc.strokes.map(stroke=>stroke.id));whiteboard.mapStrokes(ids,stroke=>transformInk([stroke],previous,anchor)[0]);adopted=adopted||ids.size>0;
        }
        if(record.input.autoGrow&&JSON.stringify(previous)!==JSON.stringify(anchor)){
          // Make room for existing scratch notes instead of silently turning
          // them into an answer when the crop grows or changes position.
          const blocked=whiteboard.strokes.filter(stroke=>!owners.has(stroke.id)&&!strokeInRectangle(stroke,previous)&&strokeInRectangle(stroke,anchor));
          if(blocked.length){const bottom=Math.max(...live.map(row=>row.nextAnchor.y+row.nextAnchor.height));for(const stroke of blocked){const delta=bottom+16-Math.min(...stroke.points.map(point=>point.y));whiteboard.mapStrokes(new Set([stroke.id]),item=>({...item,points:item.points.map(point=>({...point,y:round(point.y+delta)}))}));}adopted=true;}
        }
        record.anchor=anchor;
      }
      for(const record of live){
        const doc=record.document,anchor=record.nextAnchor;
        const strokes=transformInk(whiteboard.strokes.filter(stroke=>(!owners.has(stroke.id)||owners.get(stroke.id)===record)&&strokeInRectangle(stroke,anchor)),anchor,{x:0,y:0,width:doc.width,height:doc.height});
        const update={id:doc.id,strokes,anchor},signature=JSON.stringify(update);
        if(signature!==record.lastSent){record.lastSent=signature;if(!strokes.length&&!doc.strokes.length&&doc.inkSource!=='draft')continue;const Event=container.ownerDocument.defaultView.CustomEvent;record.frame.dispatchEvent(new Event('qf-answer-ink',{detail:update}));}
      }
      if(adopted)onAdopt?.();
    }finally{syncing=false;}
  }
  function paintPractice(context,pixelRatio){
    for(const record of collect()){
      if(!record.input.displayInk)continue;const {screen,document:doc}=record;
      context.save();context.setTransform(pixelRatio,0,0,pixelRatio,0,0);context.beginPath();context.rect(screen.x,screen.y,screen.width,screen.height);context.clip();
      const scale=screen.width/doc.width;context.translate(screen.x,screen.y);context.scale(scale,scale);for(const stroke of doc.strokes)paintInkStroke(context,stroke);context.restore();
    }
  }
  function imageAt(point){
    for(const row of collect().reverse()){
      if(!row.input.writable||row.input.imagesEditable!==true)continue;
      const scale=row.screen.width/row.document.width,x=(point.x-row.screen.x)/scale,y=(point.y-row.screen.y)/scale;
      const image=[...(row.document.images||[])].reverse().find(item=>x>=item.x&&x<=item.x+item.width&&y>=item.y&&y<=item.y+item.height);
      if(image)return {frame:row.frame,id:row.input.id,imageId:image.id};
    }return null;
  }
  function imageCommand(target,action){const Event=container.ownerDocument.defaultView.CustomEvent;target.frame.dispatchEvent(new Event('qf-answer-area-command',{detail:{action,id:target.id,imageId:target.imageId}}));}
  function dismissImages(){const selected=collect().filter(row=>row.input.selectedImageId);for(const row of selected)imageCommand({frame:row.frame,id:row.input.id},'deactivate-image');return selected.length>0;}
  return {imageAt,selectImage:target=>imageCommand(target,'select-image'),dismissImages,sync,paintPractice,hasAreas:()=>collect().some(record=>record.input.displayInk),forget(ids){for(const id of ids)forgotten.add(id);},reset(){forgotten=new Set();records=new WeakMap();}};
}
