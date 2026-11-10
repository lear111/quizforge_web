import {bindAdminContact} from '../shell/admin-contact.js';
const userViews=new WeakMap();
export function bindUserCenter({request,login,document=globalThis.document}){
  const get=id=>document.getElementById(`user-center-${id}`),container=get('root');
  userViews.get(container)?.destroy();
  const dialog=document.getElementById('network-settings-dialog'),panel=get('panel'),tab=document.getElementById('settings-user-tab');
  const tabs=[...document.querySelectorAll('.settings-tabs [role="tab"]')],listeners=[];
  let contactView=null;
  const mounted=document.defaultView.QuizForgeUI.mountUserCenter({container,panel,request,login,
    isOpen:()=>dialog.open&&!panel.hidden,
    show(){for(const id of ['network-settings-form','ai-settings-panel','development-settings-panel','appearance-settings-panel']){const other=document.getElementById(id);if(other)other.hidden=true;}panel.hidden=false;tabs.forEach(node=>node.setAttribute('aria-selected',String(node===tab)));},
    close(){dialog.close();},openContact:()=>contactView?.open(),closeContact:()=>contactView?.close()});
  contactView=bindAdminContact({request,document,bindButton:false});
  const listen=(node,event,handler)=>{node.addEventListener(event,handler);listeners.push(()=>node.removeEventListener(event,handler));};
  const hide=()=>{mounted.deactivate();panel.hidden=true;tab.setAttribute('aria-selected','false');};
  for(const node of tabs)listen(node,'click',()=>{if(node===tab)void mounted.open();else hide();});
  listen(dialog,'close',()=>{if(!dialog.open)hide();});
  listen(dialog,'cancel',event=>{if(!event.defaultPrevented)hide();});
  let destroyed=false;
  const view={open:mounted.open,destroy(){if(destroyed)return;destroyed=true;listeners.forEach(remove=>remove());mounted.destroy();contactView.destroy();if(userViews.get(container)===view)userViews.delete(container);}};
  userViews.set(container,view);return view;
}
