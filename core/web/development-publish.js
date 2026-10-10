export function bindDevelopmentPublish({request,getActive,onPublished,document=globalThis.document}){
  const get=id=>document.getElementById(`development-publish-${id}`),dialog=get('dialog'),openButton=get('open'),confirm=get('confirm'),cancel=get('cancel'),status=get('status'),error=get('error');
  const listeners=[];let plan=null,folder=null,busy=false,epoch=0;
  const listen=(node,event,handler)=>{node.addEventListener(event,handler);listeners.push(()=>node.removeEventListener(event,handler));};
  const path=()=>`/api/development/extensions/${encodeURIComponent(folder)}/publish`;
  function lock(){confirm.disabled=busy||!plan;cancel.disabled=busy;dialog.setAttribute('aria-busy',String(busy));}
  function showError(cause){error.textContent=cause?.message||'发布失败，请检查开发版文件。';error.hidden=false;}
  async function open(){
    const pane=getActive();if(!pane||pane.kind!=='development'||pane.development?.mode!=='runtime'||busy)return;
    const token=++epoch;folder=pane.id;plan=null;busy=true;error.hidden=true;status.textContent='正在检查完整拓展…';get('identity').textContent='';get('target').textContent='';lock();dialog.showModal();
    try{const value=await request(path());if(token!==epoch||!dialog.open)return;if(value.valid!==true||typeof value.revision!=='string'||!value.id||!value.version||!value.targetFolder)throw new Error('拓展尚未通过发布检查');plan=value;get('identity').textContent=`${value.name||value.id} · ${value.id}@${value.version}`;get('target').textContent=`extensions/${value.targetFolder}`;status.textContent='检查通过。发布将生成独立的正式版本，保留当前开发目录。';}
    catch(cause){if(token===epoch&&dialog.open){status.textContent='未能准备发布。';showError(cause);}}
    finally{if(token===epoch){busy=false;lock();}}
  }
  async function publish(){
    if(busy||!plan)return;const token=epoch;busy=true;error.hidden=true;status.textContent='正在生成正式版本…';lock();
    try{const value=await request(path(),{method:'POST',body:JSON.stringify({revision:plan.revision})});await onPublished?.(value,plan);if(token===epoch)dialog.close();}
    catch(cause){if(token===epoch&&dialog.open)showError(cause);}
    finally{if(token===epoch){busy=false;lock();}}
  }
  listen(openButton,'click',()=>void open());listen(confirm,'click',()=>void publish());listen(cancel,'click',()=>{if(!busy)dialog.close();});
  listen(dialog,'cancel',event=>{if(busy)event.preventDefault();});listen(dialog,'close',()=>{epoch++;plan=null;busy=false;});
  return {open,destroy(){epoch++;listeners.forEach(remove=>remove());}};
}
