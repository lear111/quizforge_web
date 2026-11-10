const developmentViews=new WeakMap();
export function bindDevelopmentSettings({request,beforeSave,onSaved,document=globalThis.document}){
  const get=id=>document.getElementById(`development-settings-${id}`),container=get('root');
  developmentViews.get(container)?.destroy();
  const dialog=document.getElementById('network-settings-dialog'),panel=get('panel'),form=get('form');
  const tab=document.getElementById('settings-development-tab'),tabs=[...document.querySelectorAll('.settings-tabs [role="tab"]')],listeners=[];
  const hide=()=>{panel.hidden=true;tab.setAttribute('aria-selected','false');};
  const mounted=document.defaultView.QuizForgeUI.mountDevelopmentSettings({container,form,request,beforeSave,onSaved,
    isOpen:()=>dialog.open&&!panel.hidden,
    show(){for(const id of ['network-settings-form','ai-settings-panel','user-center-panel','appearance-settings-panel']){const other=document.getElementById(id);if(other)other.hidden=true;}panel.hidden=false;tabs.forEach(node=>node.setAttribute('aria-selected',String(node===tab)));},
    close(){hide();dialog.close();}});
  const deactivate=()=>{mounted.deactivate();hide();};
  const listen=(node,event,handler)=>{node.addEventListener(event,handler);listeners.push(()=>node.removeEventListener(event,handler));};
  for(const node of tabs)listen(node,'click',()=>{if(node===tab)void mounted.open();else deactivate();});
  listen(form,'submit',event=>event.preventDefault());
  listen(dialog,'close',()=>{if(!dialog.open)deactivate();});
  listen(dialog,'cancel',event=>{if(!event.defaultPrevented)deactivate();});
  let destroyed=false;
  const view={open:mounted.open,destroy(){if(destroyed)return;destroyed=true;listeners.forEach(remove=>remove());mounted.destroy();if(developmentViews.get(container)===view)developmentViews.delete(container);}};
  developmentViews.set(container,view);return view;
}
