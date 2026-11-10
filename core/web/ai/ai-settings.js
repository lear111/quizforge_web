import {createHubLogin} from './hub-login.js';

const aiViews=new WeakMap();
export function bindAiSettings({request,document=globalThis.document,login=null,openWindow,setTimer,clearTimer}) {
  const get=id=>document.getElementById(`ai-settings-${id}`),container=get('root');
  aiViews.get(container)?.destroy();
  const dialog=document.getElementById('network-settings-dialog'),network=document.getElementById('network-settings-form');
  const panel=get('panel'),form=get('form'),tabs=[...document.querySelectorAll('.settings-tabs [role="tab"]')];
  const hubLogin=login??createHubLogin({request,document,openWindow,setTimer,clearTimer});
  const reset=()=>{network.hidden=false;panel.hidden=true;tabs.forEach(tab=>tab.setAttribute('aria-selected',String(tab.id==='settings-network-tab')));};
  const mounted=document.defaultView.QuizForgeUI.mountAiSettings({container,form,request,login:hubLogin,
    isOpen:()=>dialog.open&&!panel.hidden,
    show(){network.hidden=true;panel.hidden=false;for(const id of ['development-settings-panel','user-center-panel','appearance-settings-panel']){const other=document.getElementById(id);if(other)other.hidden=true;}tabs.forEach(tab=>tab.setAttribute('aria-selected',String(tab.id==='settings-ai-tab')));},
    close(){reset();dialog.close();}});
  const listeners=[];
  const listen=(node,event,handler)=>{node.addEventListener(event,handler);listeners.push(()=>node.removeEventListener(event,handler));};
  for(const tab of tabs)listen(tab,'click',()=>{if(tab.id==='settings-ai-tab')void mounted.open();else{mounted.deactivate();if(tab.id==='settings-network-tab')reset();}});
  listen(form,'submit',event=>{event.preventDefault();void mounted.save();});
  listen(dialog,'close',()=>{if(!dialog.open){mounted.deactivate();reset();}});
  listen(dialog,'cancel',event=>{if(!event.defaultPrevented){mounted.deactivate();reset();}});
  let destroyed=false;
  const view={open:mounted.open,destroy(){if(destroyed)return;destroyed=true;listeners.forEach(remove=>remove());mounted.destroy();if(aiViews.get(container)===view)aiViews.delete(container);}};
  aiViews.set(container,view);return view;
}
