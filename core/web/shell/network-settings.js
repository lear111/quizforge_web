const networkViews=new WeakMap();
export function bindNetworkSettings({request,beforeSave,onSaved,document=globalThis.document,confirm=globalThis.confirm,clipboard=globalThis.navigator?.clipboard}) {
  const get=id=>document.getElementById(`network-settings-${id}`),container=get('root');
  networkViews.get(container)?.destroy();
  const dialog=get('dialog'),form=get('form'),listeners=[];
  const mounted=document.defaultView.QuizForgeUI.mountNetworkSettings({container,form,dialog,closeButton:get('close'),request,beforeSave,onSaved,confirm,
    copy:value=>clipboard.writeText(value)});
  const listen=(node,event,handler)=>{node.addEventListener(event,handler);listeners.push(()=>node.removeEventListener(event,handler));};
  listen(get('open'),'click',mounted.open);listen(get('close'),'click',mounted.close);
  listen(form,'submit',event=>{event.preventDefault();void mounted.save();});
  listen(dialog,'cancel',event=>{if(mounted.saving)event.preventDefault();else mounted.closed();});
  listen(dialog,'close',()=>{if(!dialog.open)mounted.closed();});
  let destroyed=false;
  const view={open:mounted.open,refresh:mounted.refresh,destroy(){if(destroyed)return;destroyed=true;listeners.forEach(remove=>remove());mounted.destroy();if(networkViews.get(container)===view)networkViews.delete(container);}};
  networkViews.set(container,view);return view;
}
