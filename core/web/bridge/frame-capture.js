// Read-only display services for the opaque extension frame: a snapshot for
// region capture, and the areas of controls a learner can use. Rendering and
// all pointer decisions stay in the host. This function is serialized into the
// frame, so it must stay self-contained.
export function installFrameCapture({ session }) {
  window.addEventListener('message', event => {
    const value=event.data;
    if(event.source!==parent||value?.channel!=='quizforge-host'||value.session!==session||value.kind!=='capture-region'||typeof value.id!=='string')return;
    const send=data=>parent.postMessage({channel:'quizforge-extension',session,kind:'captured-region',id:value.id,...data},'*');
    try {
      const clone=document.createElement('div');clone.innerHTML=document.body.innerHTML;
      const originals=[document.body,...document.body.querySelectorAll('*')],copies=[clone,...clone.querySelectorAll('*')];
      for(let index=0;index<originals.length;index++) {
        const source=originals[index],target=copies[index];
        if(['SCRIPT','STYLE','IFRAME','OBJECT','EMBED','LINK','META'].includes(source.tagName)){target.remove();continue;}
        const style=getComputedStyle(source);target.style.cssText=Array.from(style).map(key=>`${key}:${style.getPropertyValue(key)};`).join('');
        for(const attribute of [...target.attributes])if(/^on/i.test(attribute.name))target.removeAttribute(attribute.name);
        if(source instanceof HTMLInputElement){target.setAttribute('value',source.type==='password'?'':source.value);if(source.checked)target.setAttribute('checked','');else target.removeAttribute('checked');}
        if(source instanceof HTMLTextAreaElement)target.textContent=source.value;
        if(source instanceof HTMLOptionElement){if(source.selected)target.setAttribute('selected','');else target.removeAttribute('selected');}
        if(source instanceof HTMLCanvasElement||source instanceof HTMLImageElement&&source.currentSrc.startsWith('blob:')){
          const canvas=source instanceof HTMLCanvasElement?source:Object.assign(document.createElement('canvas'),{width:source.naturalWidth,height:source.naturalHeight});
          if(source!==canvas)canvas.getContext('2d').drawImage(source,0,0);
          const image=document.createElement('img');image.src=canvas.toDataURL('image/png');image.style.cssText=target.style.cssText;target.replaceWith(image);
        }
      }
      const html=clone.outerHTML;
      if(html.length>8000000)throw new Error('题目页面过大，请简化内容后重试');
      send({ok:true,html,width:document.documentElement.clientWidth,height:document.body.scrollHeight});
    }catch(error){send({ok:false,error:error.message||'题目内容读取失败'});}
  });

  // The draft hand tool lets these areas through to the page and pans elsewhere.
  // Rectangles are merged into disjoint boxes in frame pixels.
  const interactive='a[href],button,input:not([type="hidden"]),select,textarea,label,summary,[contenteditable]:not([contenteditable="false"]),[role="button"],[role="checkbox"],[role="radio"],[role="switch"],[role="tab"],[role="option"],[role="slider"],[role="spinbutton"],[role="textbox"],[role="combobox"],[role="link"],[role="menuitem"],[tabindex]:not([tabindex="-1"]),[data-qf-interactive]';
  const merge=rects=>{
    const edges=[...new Set(rects.flatMap(rect=>[rect[1],rect[1]+rect[3]]))].sort((a,b)=>a-b),merged=[];
    let previous=[];
    for(let index=0;index<edges.length-1;index++){
      const top=edges[index],bottom=edges[index+1],spans=[];
      for(const rect of rects)if(rect[1]<=top&&rect[1]+rect[3]>=bottom)spans.push([rect[0],rect[0]+rect[2]]);
      spans.sort((a,b)=>a[0]-b[0]);
      const row=[];
      for(const span of spans){const last=row[row.length-1];if(last&&span[0]<=last[1])last[1]=Math.max(last[1],span[1]);else row.push([...span]);}
      const next=[];
      for(const [left,right] of row){
        const above=previous.find(box=>box[0]===left&&box[0]+box[2]===right&&box[1]+box[3]===top);
        if(above){above[3]=bottom-above[1];next.push(above);}else{const box=[left,top,right-left,bottom-top];merged.push(box);next.push(box);}
      }
      previous=next;
    }
    return merged;
  };
  let timer=0,last='';
  const report=()=>{
    timer=0;
    if(!document.body)return;
    const elements=new Set(document.body.querySelectorAll(interactive)),all=document.body.getElementsByTagName('*');
    // Custom option cards often have only a click handler and a pointer cursor.
    for(let index=0;index<all.length&&index<4000;index++)if(!elements.has(all[index])&&getComputedStyle(all[index]).cursor==='pointer')elements.add(all[index]);
    const rects=[];
    for(const element of elements){
      if(element.disabled||element.closest('[data-qf-interactive="false"]'))continue;
      for(const rect of element.getClientRects()){
        if(rect.width<1||rect.height<1)continue;
        rects.push([Math.floor(rect.left),Math.floor(rect.top),Math.ceil(rect.width)+1,Math.ceil(rect.height)+1]);
        if(rects.length>=600)break;
      }
      if(rects.length>=600)break;
    }
    const value=merge(rects).slice(0,600),serialized=JSON.stringify(value);
    if(serialized===last)return;
    last=serialized;
    parent.postMessage({channel:'quizforge-extension',session,kind:'interactive-regions',rects:value},'*');
  };
  const schedule=()=>{if(!timer)timer=setTimeout(report,60);};
  if(typeof ResizeObserver==='function'&&document.body&&document.documentElement){const observer=new ResizeObserver(schedule);observer.observe(document.body);observer.observe(document.documentElement);}
  if(typeof MutationObserver==='function'&&document.documentElement)new MutationObserver(schedule).observe(document.documentElement,{subtree:true,childList:true,attributes:true});
  for(const name of ['load','transitionend','animationend','change'])window.addEventListener(name,schedule,true);
  schedule();
}
