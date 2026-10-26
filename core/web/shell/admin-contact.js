export const ADMIN_CONTACT_PATH='/api/settings/admin-contact';
const failure='暂时无法读取联系方式，请重试。';

export function bindAdminContact({request,document=globalThis.document}){
  const get=id=>document.getElementById(`admin-contact-${id}`),dialog=get('dialog'),button=document.getElementById('user-center-contact');
  const status=get('status'),content=get('content'),retry=get('retry'),listeners=[];
  let pending=null,epoch=0,destroyed=false;
  const listen=(node,event,handler)=>{node.addEventListener(event,handler);listeners.push(()=>node.removeEventListener(event,handler));};
  function cancel(){epoch++;pending?.abort();pending=null;dialog.setAttribute('aria-busy','false');}
  async function read(){
    cancel();const token=epoch,controller=new AbortController();pending=controller;
    content.textContent='';content.hidden=true;retry.hidden=true;status.hidden=false;status.textContent='正在读取联系方式…';status.setAttribute('role','status');dialog.setAttribute('aria-busy','true');
    try{
      const value=await request(ADMIN_CONTACT_PATH,{signal:controller.signal,timeoutMs:11000});
      if(destroyed||token!==epoch||!dialog.open)return;
      if(!value||typeof value.content!=='string'||value.content.length>4000||!Number.isSafeInteger(value.revision)||value.revision<0)throw new Error('Invalid contact response');
      if(value.content===''){status.textContent='管理员尚未填写联系方式。';}
      else{status.hidden=true;content.textContent=value.content;content.hidden=false;}
    }catch{
      if(destroyed||token!==epoch||!dialog.open)return;
      status.textContent=failure;status.setAttribute('role','alert');retry.hidden=false;
    }finally{if(token===epoch){pending=null;dialog.setAttribute('aria-busy','false');}}
  }
  function open(){if(destroyed||dialog.open)return;dialog.showModal();void read();}
  function close(){cancel();content.textContent='';content.hidden=true;if(dialog.open)dialog.close();}
  listen(button,'click',open);listen(retry,'click',()=>void read());listen(get('close'),'click',close);listen(get('done'),'click',close);
  listen(dialog,'cancel',event=>{event.preventDefault();close();});listen(dialog,'close',()=>{if(dialog.open)return;cancel();content.textContent='';content.hidden=true;});
  return {close,destroy(){destroyed=true;close();listeners.forEach(remove=>remove());}};
}
