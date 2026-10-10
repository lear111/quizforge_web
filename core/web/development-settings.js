export function bindDevelopmentSettings({request,beforeSave,onSaved,document=globalThis.document}){
  const get=id=>document.getElementById(`development-settings-${id}`),dialog=document.getElementById('network-settings-dialog');
  const panel=get('panel'),form=get('form'),status=get('status'),error=get('error'),enabled=get('enabled');
  const tab=document.getElementById('settings-development-tab'),tabs=[...document.querySelectorAll('.settings-tabs [role="tab"]')];
  const panels=[document.getElementById('network-settings-form'),document.getElementById('ai-settings-panel'),panel];
  const listeners=[];let value=null,busy=false,epoch=0,saving=null;
  const listen=(node,event,handler)=>{node.addEventListener(event,handler);listeners.push(()=>node.removeEventListener(event,handler));};
  function lock(){enabled.disabled=busy||!value||value.canManage===false;form.setAttribute('aria-busy',String(busy));}
  function render(next){value=next;enabled.checked=Boolean(next.enabled);status.hidden=next.canManage!==false;status.textContent=next.canManage===false?'开发者模式只能在运行 QuizForge 的电脑上修改。':'';lock();}
  function showError(cause){
    if(cause?.code==='NOT_FOUND'){
      status.textContent='当前服务尚未提供开发者接口。';
      status.hidden=false;
      error.textContent='请先保存作答，关闭原启动窗口后重新启动 QuizForge，再刷新页面。';
    }else{
      if(!value){status.textContent='读取开发者设置失败。';status.hidden=false;}
      error.textContent=cause?.code==='LOCAL_SETTINGS_ONLY'?'请在运行 QuizForge 的电脑上修改开发者设置。':cause?.message||'开发者设置操作失败，请重试。';
    }
    error.hidden=false;
  }
  async function open(){
    const token=++epoch;panels.forEach(node=>{node.hidden=node!==panel;});tabs.forEach(node=>node.setAttribute('aria-selected',String(node===tab)));
    value=null;busy=true;error.hidden=true;status.hidden=false;status.textContent='正在读取开发者设置…';lock();
    try{await saving;const next=await request('/api/settings/development');if(token===epoch&&dialog.open)render(next);}
    catch(cause){if(token===epoch&&dialog.open)showError(cause);}
    finally{if(token===epoch){busy=false;lock();}}
  }
  async function save(){
    if(busy||saving)return;
    if(!value||value.canManage===false){if(value)enabled.checked=Boolean(value.enabled);return;}
    const desired=enabled.checked;if(desired===value.enabled)return;
    const token=epoch;let next=value;busy=true;error.hidden=true;status.hidden=false;status.textContent='正在保存…';lock();
    const task=(async()=>{
      try{await beforeSave?.({enabled:desired});next=await request('/api/settings/development',{method:'PUT',body:JSON.stringify({enabled:desired})});await onSaved?.(next);if(token===epoch&&dialog.open)render(next);}
      catch(cause){if(token===epoch&&dialog.open){render(next);showError(cause);}}
      finally{if(token===epoch){busy=false;lock();}}
    })();
    saving=task;await task;if(saving===task)saving=null;
  }
  listen(tab,'click',()=>{if(!busy)void open();});
  for(const other of tabs.filter(node=>node!==tab))listen(other,'click',()=>{epoch++;busy=false;panel.hidden=true;tab.setAttribute('aria-selected','false');});
  listen(enabled,'change',()=>{void save();});listen(form,'submit',event=>event.preventDefault());listen(get('close'),'click',()=>dialog.close());
  listen(dialog,'close',()=>{epoch++;busy=false;panel.hidden=true;tab.setAttribute('aria-selected','false');});
  return {open,destroy(){epoch++;listeners.forEach(remove=>remove());}};
}
