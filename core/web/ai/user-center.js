import {yuan} from './hub-login.js';
import {bindAdminContact} from '../shell/admin-contact.js';

const HUB='/api/settings/ai/hub';

// Settings → 用户中心: the QuizForge account this computer is logged in to, its free AI
// points and redeem codes (Hub docs/HUB_CONNECT_AI.md 5, 6.1). Only the host computer can log in.
export function bindUserCenter({request,login,document=globalThis.document}){
  const get=id=>document.getElementById(`user-center-${id}`),dialog=document.getElementById('network-settings-dialog');
  const tab=document.getElementById('settings-user-tab'),tabs=[...document.querySelectorAll('.settings-tabs [role="tab"]')];
  const panel=get('panel'),status=get('status'),error=get('error'),account=get('account'),guest=get('guest');
  const name=get('name'),device=get('device'),avatar=get('avatar'),points=get('points'),form=get('redeem'),code=get('code'),submit=get('redeem-submit'),result=get('redeem-result');
  const manage=get('manage'),refresh=get('refresh'),logout=get('logout'),loginButton=get('login');
  const contact=get('contact'),contactView=bindAdminContact({request,document});
  const others=['network-settings-form','ai-settings-panel','development-settings-panel','appearance-settings-panel'].map(id=>document.getElementById(id)).filter(Boolean);
  const listeners=[];let value=null,busy=false,epoch=0;
  const listen=(node,event,handler)=>{node.addEventListener(event,handler);listeners.push(()=>node.removeEventListener(event,handler));};
  function lock(){for(const node of [code,submit,refresh,logout,loginButton])node.disabled=busy||!value;submit.textContent=busy?'正在处理…':'兑换';panel.setAttribute('aria-busy',String(busy));}
  function showError(cause){error.textContent=cause?.message||'操作没有完成，请重试。';error.hidden=false;}
  function showPoints(ai){
    points.textContent=value?.unavailable?'暂时查询不到':ai?ai.enabled?yuan(ai.balance):`${yuan(ai.balance)} · 暂不可用`:'—';
    points.classList.toggle('empty',Boolean(ai&&ai.balance<1));
  }
  function render(next){
    value=next;const connected=Boolean(next.connected);contact.hidden=false;
    account.hidden=!connected;guest.hidden=connected;status.hidden=true;
    if(connected){
      const user=next.user?.name||'';name.textContent=user;avatar.textContent=Array.from(user)[0]||'Q';device.textContent=`这台电脑：${next.device?.name||''}`;
      showPoints(next.ai);manage.hidden=!next.manageUrl;if(next.manageUrl)manage.href=next.manageUrl;
      if(next.unavailable){status.textContent='暂时无法连接 QuizForge 服务器，余额可能不是最新。';status.hidden=false;}
    }else if(next.expired){status.textContent='登录已失效，请重新登录 QuizForge 账号。';status.hidden=false;}
    lock();
  }
  function hide(){epoch++;login.cancel();contactView.close();busy=false;panel.hidden=true;tab.setAttribute('aria-selected','false');}
  async function load(token){const next=await request(HUB);if(token===epoch&&dialog.open)render(next);return next;}
  async function open(){
    const token=++epoch;others.forEach(node=>{node.hidden=true;});panel.hidden=false;tabs.forEach(node=>node.setAttribute('aria-selected',String(node===tab)));
    value=null;busy=true;error.hidden=true;result.textContent='';account.hidden=true;guest.hidden=true;contact.hidden=true;status.hidden=false;status.textContent='正在读取账号…';lock();
    try{await load(token);}
    catch(cause){
      if(token!==epoch||!dialog.open)return;
      if(cause?.code==='LOCAL_SETTINGS_ONLY'){status.textContent='用户中心只能在运行 QuizForge 的电脑上查看和登录。手机等设备评分时使用电脑上的账号和额度。';return;}
      showError(cause);status.textContent='读取账号失败。';
    }
    finally{if(token===epoch){busy=false;lock();}}
  }
  async function run(task){
    if(busy||!value)return;const token=epoch;busy=true;error.hidden=true;lock();
    try{await task(token);}catch(cause){if(token===epoch&&dialog.open)showError(cause);}
    finally{if(token===epoch){busy=false;lock();}}
  }
  async function redeem(event){
    event.preventDefault();const input=code.value.trim();
    if(!input){result.textContent='请输入兑换码。';result.classList.add('error');return;}
    await run(async token=>{
      result.textContent='';result.classList.remove('error');
      try{
        const added=await request(`${HUB}/redeem`,{method:'POST',body:JSON.stringify({code:input})});if(token!==epoch||!dialog.open)return;
        code.value='';result.textContent=`已兑换 ${yuan(added.added)}，当前剩余 ${yuan(added.balance)}。`;
        value={...value,ai:{...(value.ai||{enabled:true}),balance:added.balance}};showPoints(value.ai);
      }catch(cause){
        if(token!==epoch||!dialog.open)return;
        result.textContent=cause?.message||'兑换没有完成，请重试。';result.classList.add('error');
        if(cause?.code==='HUB_LOGIN_REQUIRED')await load(token);
      }
    });
  }
  listen(tab,'click',()=>{if(!busy)void open();});
  for(const other of tabs.filter(node=>node!==tab))listen(other,'click',hide);
  listen(dialog,'close',hide);listen(get('close'),'click',()=>dialog.close());
  listen(form,'submit',redeem);listen(code,'input',()=>{result.textContent='';result.classList.remove('error');});
  listen(refresh,'click',()=>void run(load));
  listen(logout,'click',()=>void run(async token=>{const next=await request(`${HUB}/logout`,{method:'POST',body:'{}'});if(token===epoch&&dialog.open){render(next);status.textContent='已退出登录。免费 AI 额度需要重新登录后才能使用。';status.hidden=false;}}));
  listen(loginButton,'click',()=>void run(async token=>{const next=await login.login();if(token===epoch&&dialog.open&&next?.connected)render(next);}));
  return {open,destroy(){epoch++;login.cancel();contactView.destroy();listeners.forEach(remove=>remove());}};
}
