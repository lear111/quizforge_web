// Per-device appearance: a theme for the host shell and, for the image theme,
// a picture kept in this browser only. Nothing here is sent to the server.
export const THEMES=Object.freeze([
  {id:'default',label:'默认'},
  {id:'mist',label:'晨雾'},
  {id:'paper',label:'纸张'},
  {id:'sepia',label:'护眼米黄'},
  {id:'green',label:'护眼豆绿'},
  {id:'image',label:'图片'},
]);
export const DEFAULT_DIM=30;
const STORAGE_KEY='quizforge-appearance',MAX_DIM=80,MAX_INPUT_BYTES=30*1024*1024;

export function readAppearance(storage){
  let saved={};
  try{saved=JSON.parse(storage?.getItem(STORAGE_KEY)||'{}')||{};}catch{saved={};}
  const theme=THEMES.some(item=>item.id===saved.theme)?saved.theme:'default';
  const dim=Number.isInteger(saved.dim)&&saved.dim>=0&&saved.dim<=MAX_DIM&&saved.dim%5===0?saved.dim:DEFAULT_DIM;
  return {theme,dim,custom:saved.custom===true};
}
export function writeAppearance(storage,value){
  try{storage?.setItem(STORAGE_KEY,JSON.stringify({theme:value.theme,dim:value.dim,custom:value.custom}));}catch{/* A private window may refuse storage; the choice still applies until reload. */}
}
export function applyAppearance(root,value,imageUrl=null){
  if(value.theme==='default')delete root.dataset.qfTheme;else root.dataset.qfTheme=value.theme;
  root.style.setProperty('--qf-dim',String(value.dim/100));
  if(imageUrl)root.style.setProperty('--qf-image',`url("${imageUrl}")`);else root.style.removeProperty('--qf-image');
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

export function bindAppearanceSettings({document=globalThis.document,storage=globalThis.localStorage,images=createImageStore(),URL=globalThis.URL}={}){
  const get=id=>document.getElementById(`appearance-${id}`),root=document.documentElement;
  const dialog=document.getElementById('network-settings-dialog'),tab=document.getElementById('settings-appearance-tab');
  const panel=document.getElementById('appearance-settings-panel'),list=get('themes'),imageBox=get('image'),choose=get('image-choose'),reset=get('image-reset'),file=get('image-file');
  const dim=get('dim'),dimValue=get('dim-value'),error=get('error'),close=get('close');
  const listeners=[],buttons=new Map();
  const listen=(node,event,handler)=>{if(!node)return;node.addEventListener(event,handler);listeners.push(()=>node.removeEventListener(event,handler));};
  let value=readAppearance(storage),imageUrl=null,busy=false,destroyed=false;

  const apply=()=>applyAppearance(root,value,value.custom?imageUrl:null);
  const save=()=>writeAppearance(storage,value);
  function showError(message){if(!error)return;error.textContent=message||'';error.hidden=!message;}
  function setImageUrl(blob){if(imageUrl)URL.revokeObjectURL(imageUrl);imageUrl=blob?URL.createObjectURL(blob):null;}
  function render(){
    for(const [id,button] of buttons){const selected=id===value.theme;button.setAttribute('aria-checked',String(selected));button.tabIndex=selected?0:-1;}
    if(imageBox)imageBox.hidden=value.theme!=='image';
    if(dim){dim.value=String(value.dim);dimValue.textContent=`${value.dim}%`;}
    if(reset)reset.hidden=!value.custom;
    if(choose)choose.disabled=busy||!images;
  }
  function select(id,{focus=false}={}){
    if(!THEMES.some(item=>item.id===id))return;
    value={...value,theme:id};save();apply();render();showError('');
    if(focus)buttons.get(id)?.focus();
  }
  if(list){
    for(const item of THEMES){
      const button=document.createElement('button'),swatch=document.createElement('span'),label=document.createElement('span');
      button.type='button';button.className='appearance-theme';button.dataset.theme=item.id;button.setAttribute('role','radio');
      swatch.className='appearance-swatch';swatch.dataset.swatch=item.id;swatch.setAttribute('aria-hidden','true');label.textContent=item.label;
      button.append(swatch,label);list.append(button);buttons.set(item.id,button);
      listen(button,'click',()=>select(item.id));
    }
    listen(list,'keydown',event=>{
      const step={ArrowRight:1,ArrowDown:1,ArrowLeft:-1,ArrowUp:-1}[event.key];if(!step)return;event.preventDefault();
      const index=THEMES.findIndex(item=>item.id===value.theme),next=THEMES[(index+step+THEMES.length)%THEMES.length];select(next.id,{focus:true});
    });
  }
  function open(){
    for(const node of [document.getElementById('network-settings-form'),document.getElementById('ai-settings-panel'),document.getElementById('development-settings-panel')])if(node)node.hidden=true;
    for(const node of document.querySelectorAll('.settings-tabs [role="tab"]'))node.setAttribute('aria-selected',String(node===tab));
    panel.hidden=false;showError('');render();
  }
  function hide(){panel.hidden=true;tab?.setAttribute('aria-selected','false');}
  listen(tab,'click',open);
  for(const other of document.querySelectorAll('.settings-tabs [role="tab"]'))if(other!==tab)listen(other,'click',hide);
  listen(dialog,'close',hide);listen(close,'click',()=>dialog?.close());
  listen(dim,'input',()=>{const next=Number(dim.value);if(!Number.isInteger(next))return;value={...value,dim:next};dimValue.textContent=`${next}%`;apply();save();});
  listen(choose,'click',()=>{showError('');file?.click();});
  listen(file,'change',async()=>{
    const picked=file.files?.[0];file.value='';if(!picked||!images||busy)return;
    busy=true;render();showError('');choose.textContent='正在处理图片…';
    try{
      const blob=await prepareImage(picked,{document});
      await images.put(blob);if(destroyed)return;
      setImageUrl(blob);value={...value,theme:'image',custom:true};save();apply();
    }catch(cause){showError(cause?.message||'图片未能保存，请重试');}
    finally{busy=false;choose.textContent='选择图片';render();}
  });
  listen(reset,'click',async()=>{
    if(busy)return;busy=true;render();
    try{await images?.remove();setImageUrl(null);value={...value,custom:false};save();apply();showError('');}
    catch(cause){showError(cause?.message||'未能恢复默认图片，请重试');}
    finally{busy=false;render();}
  });

  apply();render();
  const ready=(async()=>{
    if(!value.custom||!images)return;
    try{const blob=await images.get();if(destroyed)return;if(blob instanceof Blob){setImageUrl(blob);apply();}else{value={...value,custom:false};save();render();}}
    catch{/* The default picture stays in place when the saved image cannot be read. */}
  })();
  return {ready,open,get value(){return value;},destroy(){destroyed=true;listeners.forEach(remove=>remove());setImageUrl(null);}};
}
