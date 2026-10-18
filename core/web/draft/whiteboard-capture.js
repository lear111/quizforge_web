let renderer;
export async function copyCaptureImage(blob, win=globalThis) {
  if(!win.isSecureContext)throw new Error('当前 HTTP 地址不支持复制图片，请使用 HTTPS 或本机地址，也可下载 PNG。');
  if(!win.navigator?.clipboard?.write||!win.ClipboardItem)throw new Error('当前浏览器不支持复制图片，请下载 PNG。');
  try{await win.navigator.clipboard.write([new win.ClipboardItem({'image/png':blob})]);}
  catch{throw new Error('复制未成功，请允许浏览器访问剪贴板后重试，或下载 PNG。');}
}
// html2canvas 1.4.1 cannot parse color(), color-mix(), oklch() and similar
// modern colors. Pages styled with color-mix() report computed colors as
// color(srgb r g b / a), so convert those to rgba() before rendering.
const MODERN_COLOR=/\b(?:color|color-mix|oklch|oklab|lab|lch|hwb)\((?:[^()]|\([^()]*\))*\)/gi;
const channel=value=>Math.round(Math.min(1,Math.max(0,Number(value)||0))*255);
function legacyColor(document,value){
  const srgb=/^color\(\s*srgb\s+([-\d.e+]+|none)\s+([-\d.e+]+|none)\s+([-\d.e+]+|none)\s*(?:\/\s*([-\d.e+]+%?|none))?\s*\)$/i.exec(value.trim());
  if(srgb){
    const alpha=srgb[4]===undefined||srgb[4]==='none'?1:srgb[4].endsWith('%')?Number(srgb[4].slice(0,-1))/100:Number(srgb[4]);
    return `rgba(${channel(srgb[1])}, ${channel(srgb[2])}, ${channel(srgb[3])}, ${Math.min(1,Math.max(0,Number.isFinite(alpha)?alpha:1))})`;
  }
  // Other color spaces: let the browser convert one pixel to sRGB.
  try{
    const canvas=document.createElement('canvas');canvas.width=canvas.height=1;
    const context=canvas.getContext('2d',{willReadFrequently:true});context.clearRect(0,0,1,1);context.fillStyle=value;context.fillRect(0,0,1,1);
    const [r,g,b,a]=context.getImageData(0,0,1,1).data;return `rgba(${r}, ${g}, ${b}, ${Math.round(a/255*1000)/1000})`;
  }catch{return 'rgba(0, 0, 0, 0)';}
}
export function legacyColors(document,css){return css.replace(MODERN_COLOR,match=>legacyColor(document,match));}
export function sanitizeCaptureHtml(document, html) {
  const template=document.createElement('template');template.innerHTML=html;
  const tags=new Set('div span p h1 h2 h3 h4 h5 h6 section article main header footer aside nav ul ol li strong b em i s u sub sup small label fieldset legend input textarea button select option table thead tbody tfoot tr td th caption colgroup col br hr pre code blockquote img svg g path circle ellipse rect line polyline polygon text tspan defs clippath lineargradient radialgradient stop'.split(' '));
  const attributes=new Set('style class id type value checked selected disabled rows cols width height src alt viewbox d fill stroke stroke-width stroke-linecap stroke-linejoin stroke-dasharray x y x1 y1 x2 y2 cx cy r rx ry points transform xmlns offset stop-color clip-path'.split(' '));
  for(const node of [...template.content.querySelectorAll('*')]) {
    if(!tags.has(node.tagName.toLowerCase())){node.remove();continue;}
    for(const attr of [...node.attributes])if(!attributes.has(attr.name.toLowerCase()))node.removeAttribute(attr.name);
    if(node.tagName.toLowerCase()==='img'&&!/^data:image\/(png|jpeg|webp|gif|svg\+xml)[;,]/i.test(node.getAttribute('src')||''))throw new Error('截图图片尚未准备好，请重试。');
    for(const attr of [...node.attributes])if(!['src','style','xmlns'].includes(attr.name)&&/url\s*\(|(?:https?:|blob:|javascript:|@import)/i.test(attr.value))node.removeAttribute(attr.name);
    if(node.hasAttribute('style'))node.setAttribute('style',legacyColors(document,node.getAttribute('style')));
    if(node.style){for(const key of Array.from(node.style))if(/url\s*\(|(?:https?:|blob:|javascript:|@import)/i.test(node.style.getPropertyValue(key)))node.style.removeProperty(key);}
    if(node.tagName.toLowerCase()==='input'&&node.type==='password'){node.value='';node.removeAttribute('value');}
  }
  return template.innerHTML;
}
async function renderSnapshot(document, snapshot, region) {
  const win=document.defaultView;
  await (renderer ||= import('../assets/html2canvas-1.4.1.min.js').catch(error=>{renderer=null;throw error;}));
  const html=sanitizeCaptureHtml(document,snapshot.html),frame=document.createElement('iframe');
  frame.setAttribute('sandbox','allow-same-origin');frame.setAttribute('aria-hidden','true');frame.tabIndex=-1;
  frame.style.cssText=`position:fixed;left:-100000px;top:0;width:${snapshot.width}px;height:${Math.max(1,snapshot.height)}px;border:0;pointer-events:none`;
  const ready=new Promise((resolve,reject)=>{const timer=win.setTimeout(()=>reject(new Error('截图页面加载超时')),8000);frame.onload=()=>{win.clearTimeout(timer);resolve();};});
  frame.srcdoc=`<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; frame-src about:; base-uri 'none'; form-action 'none'"><style>html,body{margin:0}</style></head><body>${html}</body></html>`;
  document.body.append(frame);
  try{await ready;return await win.html2canvas(frame.contentDocument.body,{...region,backgroundColor:null,logging:false,allowTaint:false,removeContainer:true,imageTimeout:8000,scrollX:0,scrollY:0,windowWidth:snapshot.width,windowHeight:Math.max(1,snapshot.height)});}
  finally{frame.remove();}
}
export async function captureDraftRegion({ rect, ink, draft, camera, scroll, pixelRatio }, { frame, viewport, capture }) {
  const doc=viewport.ownerDocument, scale=Math.min(pixelRatio,2);
  const output=doc.createElement('canvas');output.width=Math.max(1,Math.round(rect.width*scale));output.height=Math.max(1,Math.round(rect.height*scale));
  if(output.width*output.height>16000000)throw new Error('截图过大，请缩小范围。');
  const context=output.getContext('2d');context.scale(scale,scale);context.fillStyle=draft.paper.color;context.fillRect(0,0,rect.width,rect.height);
  if(draft.paper.pattern!=='plain') {
    const step=24*camera.zoom,offsetX=((camera.x*camera.zoom-scroll.x-rect.x)%step+step)%step,offsetY=((camera.y*camera.zoom-scroll.y-rect.y)%step+step)%step;
    context.strokeStyle='#64748b22';context.fillStyle='#47556922';context.lineWidth=1;
    if(draft.paper.pattern==='grid') {context.beginPath();for(let x=offsetX;x<rect.width;x+=step){context.moveTo(x,0);context.lineTo(x,rect.height);}for(let y=offsetY;y<rect.height;y+=step){context.moveTo(0,y);context.lineTo(rect.width,y);}context.stroke();}
    else for(let x=offsetX;x<rect.width;x+=step)for(let y=offsetY;y<rect.height;y+=step){context.beginPath();context.arc(x,y,1.5,0,Math.PI*2);context.fill();}
  }
  if(frame&&capture) {
    const view=viewport.getBoundingClientRect(),bounds=frame.getBoundingClientRect(),left=bounds.left-view.left-viewport.clientLeft,top=bounds.top-view.top-viewport.clientTop;
    const x=Math.max(rect.x,left),y=Math.max(rect.y,top),right=Math.min(rect.x+rect.width,left+bounds.width),bottom=Math.min(rect.y+rect.height,top+bounds.height);
    if(right>x&&bottom>y) {
      const snapshot=await capture(), image=await renderSnapshot(doc,snapshot,{x:(x-left)/camera.zoom,y:(y-top)/camera.zoom,width:(right-x)/camera.zoom,height:(bottom-y)/camera.zoom,scale:scale*camera.zoom});
      context.drawImage(image,x-rect.x,y-rect.y,right-x,bottom-y);
    }
  }
  context.drawImage(ink,rect.x*pixelRatio,rect.y*pixelRatio,rect.width*pixelRatio,rect.height*pixelRatio,0,0,rect.width,rect.height);
  return new Promise((resolve,reject)=>output.toBlob(blob=>blob?resolve(blob):reject(new Error('截图生成失败')),'image/png'));
}
