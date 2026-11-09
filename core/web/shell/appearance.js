// Per-device appearance: a theme for the host shell and, for the image theme,
// a picture kept in this browser only. Nothing here is sent to the server.
export const THEMES=Object.freeze([
  {id:'default',label:'默认'},
  {id:'mist',label:'晨雾'},
  {id:'paper',label:'纸张'},
  {id:'sepia',label:'护眼米黄'},
  {id:'green',label:'护眼豆绿'},
  {id:'coast',label:'青屿'},
  {id:'image',label:'图片'},
]);
export const DEFAULT_DIM=30;
// How much the library, outline and bars let the background through, per theme.
// Each theme has its own default; saved user choices take precedence.
export const DEFAULT_CLEAR=Object.freeze({mist:40,paper:0,sepia:0,green:0,coast:65,image:65});
const STORAGE_KEY='quizforge-appearance',MAX_DIM=80,MAX_CLEAR=70,MAX_INPUT_BYTES=30*1024*1024;
const validStep=(value,max)=>Number.isInteger(value)&&value>=0&&value<=max&&value%5===0;

export function readAppearance(storage){
  let saved={};
  try{saved=JSON.parse(storage?.getItem(STORAGE_KEY)||'{}')||{};}catch{saved={};}
  const theme=THEMES.some(item=>item.id===saved.theme)?saved.theme:'image';
  const dim=validStep(saved.dim,MAX_DIM)?saved.dim:DEFAULT_DIM;
  const clear={...DEFAULT_CLEAR};
  if(saved.clear&&typeof saved.clear==='object')for(const id of Object.keys(DEFAULT_CLEAR))if(validStep(saved.clear[id],MAX_CLEAR))clear[id]=saved.clear[id];
  return {theme,dim,clear,custom:saved.custom===true};
}
export function writeAppearance(storage,value){
  try{storage?.setItem(STORAGE_KEY,JSON.stringify({theme:value.theme,dim:value.dim,clear:value.clear,custom:value.custom}));}catch{/* A private window may refuse storage; the choice still applies until reload. */}
}
export function applyAppearance(root,value,imageUrl=null){
  if(value.theme==='default')delete root.dataset.qfTheme;else root.dataset.qfTheme=value.theme;
  root.style.setProperty('--qf-dim',String(value.dim/100));
  const clear=value.clear?.[value.theme]??DEFAULT_CLEAR[value.theme];
  if(clear===undefined)root.style.removeProperty('--qf-clear');else root.style.setProperty('--qf-clear',String(clear/100));
  if(imageUrl)root.style.setProperty('--qf-image',`url("${imageUrl}")`);else root.style.removeProperty('--qf-image');
}

// What extension pages see through API 1.4: the theme name and how transparent
// the shell panels are (0-0.7). The default look has no transparency.
export function readHostAppearance(root){
  const theme=root?.dataset?.qfTheme||'default',clear=Number.parseFloat(root?.style?.getPropertyValue('--qf-clear'));
  return {theme,transparency:theme!=='default'&&Number.isFinite(clear)?Math.min(1,Math.max(0,clear)):0};
}

export function createImageStore(indexedDB=globalThis.indexedDB){
  if(!indexedDB)return null;
  const open=()=>new Promise((resolve,reject)=>{
    const request=indexedDB.open('quizforge-appearance',1);
    request.onupgradeneeded=()=>request.result.createObjectStore('images');
    request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
  });
  async function run(mode,action){
    const db=await open();
    try{
      return await new Promise((resolve,reject)=>{
        const transaction=db.transaction('images',mode),request=action(transaction.objectStore('images'));
        transaction.oncomplete=()=>resolve(request.result);transaction.onerror=transaction.onabort=()=>reject(transaction.error);
      });
    }finally{db.close();}
  }
  return {get:()=>run('readonly',store=>store.get('custom')),put:blob=>run('readwrite',store=>store.put(blob,'custom')),remove:()=>run('readwrite',store=>store.delete('custom'))};
}

// Large photos are scaled and re-encoded once so the background stays light on
// tablets; re-encoding also drops location and other photo metadata.
export async function prepareImage(file,{document=globalThis.document,maxSide=2560,quality=.86,decode=globalThis.createImageBitmap}={}){
  if(!file||typeof file.type!=='string'||!file.type.startsWith('image/'))throw new Error('请选择图片文件');
  if(file.size>MAX_INPUT_BYTES)throw new Error('图片超过 30 MB，请换一张小一些的图片');
  let bitmap;
  try{bitmap=await decode(file);}catch{throw new Error('无法读取这张图片，请换成 JPG、PNG 或 WebP 格式');}
  try{
    const scale=Math.min(1,maxSide/Math.max(bitmap.width,bitmap.height)),width=Math.max(1,Math.round(bitmap.width*scale)),height=Math.max(1,Math.round(bitmap.height*scale));
    const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
    const context=canvas.getContext('2d');context.fillStyle='#ece8f6';context.fillRect(0,0,width,height);context.drawImage(bitmap,0,0,width,height);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',quality));
    if(!blob)throw new Error('图片处理失败，请重试');
    return blob;
  }finally{bitmap.close?.();}
}

const appearanceViews=new WeakMap();
export function bindAppearanceSettings({document=globalThis.document,storage=globalThis.localStorage,images=createImageStore(),URL=globalThis.URL,prepare=prepareImage}={}){
  const container=document.getElementById('appearance-settings-root');
  if(!container)return {ready:Promise.resolve(),open(){},destroy(){}};
  appearanceViews.get(container)?.destroy();
  const dialog=document.getElementById('network-settings-dialog'),tab=document.getElementById('settings-appearance-tab');
  const panel=document.getElementById('appearance-settings-panel'),listeners=[];
  const listen=(node,event,handler)=>{if(!node)return;node.addEventListener(event,handler);listeners.push(()=>node.removeEventListener(event,handler));};
  const mounted=document.defaultView.QuizForgeUI.mountAppearanceSettings({container,themes:THEMES,initial:readAppearance(storage),images,
    prepare:file=>prepare(file,{document}),save:value=>writeAppearance(storage,value),
    apply:(value,url)=>applyAppearance(document.documentElement,value,url),urls:URL,isBlob:value=>value instanceof Blob,
    close:()=>dialog?.close()});
  let destroyed=false;
  function open(){
    if(destroyed)return;
    for(const id of ['network-settings-form','ai-settings-panel','development-settings-panel']){const node=document.getElementById(id);if(node)node.hidden=true;}
    for(const node of document.querySelectorAll('.settings-tabs [role="tab"]'))node.setAttribute('aria-selected',String(node===tab));
    panel.hidden=false;mounted.clearError();
  }
  function hide(){panel.hidden=true;tab?.setAttribute('aria-selected','false');}
  listen(tab,'click',open);
  for(const other of document.querySelectorAll('.settings-tabs [role="tab"]'))if(other!==tab)listen(other,'click',hide);
  listen(dialog,'close',()=>{if(!dialog.open)hide();});
  const view={ready:mounted.ready,open,get value(){return mounted.value;},destroy(){
    if(destroyed)return;destroyed=true;listeners.forEach(remove=>remove());mounted.destroy();
    if(appearanceViews.get(container)===view)appearanceViews.delete(container);
  }};
  appearanceViews.set(container,view);return view;
}
