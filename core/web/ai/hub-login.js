const HUB='/api/settings/ai/hub';

// Logs this computer in to a QuizForge account for the free AI quota (Hub docs/HUB_CONNECT_AI.md 4):
// opens the Hub page in the browser and waits in a small dialog until the loopback callback lands.
export function createHubLogin({request,document=globalThis.document,openWindow=(url)=>globalThis.open?.(url,'_blank','noopener'),setTimer=globalThis.setTimeout?.bind(globalThis),clearTimer=globalThis.clearTimeout?.bind(globalThis)}){
  const get=id=>document.getElementById(`hub-login-${id}`);
  const dialog=get('dialog'),link=get('link'),wait=get('wait'),cancel=get('cancel');
  let active=null;
  function show(){if(dialog.open)return;try{dialog.showModal();}catch{dialog.setAttribute('open','');}}
  function hide(){if(!dialog.open)return;if(typeof dialog.close==='function')dialog.close();else dialog.removeAttribute('open');}
  function finish(value){
    const entry=active;if(!entry)return;active=null;
    if(entry.poll!==null)clearTimer?.(entry.poll);hide();entry.resolve(value);
  }
  cancel.addEventListener('click',()=>finish(null));
  dialog.addEventListener('cancel',event=>{event.preventDefault();finish(null);});
  dialog.addEventListener('close',()=>finish(null));
  // Resolves the account once logged in, or null when the user cancels or ten minutes pass.
  async function login(){
    if(active)return active.promise;
    const {authorizeUrl}=await request(`${HUB}/login`,{method:'POST',body:'{}'});
    if(active)return active.promise;
    let resolve;const promise=new Promise(done=>{resolve=done;}),entry={resolve,promise,poll:null},started=Date.now();active=entry;
    link.href=authorizeUrl;wait.textContent='等待登录…';show();openWindow(authorizeUrl);
    const tick=async()=>{
      entry.poll=null;if(active!==entry)return;
      try{const value=await request(HUB);if(active!==entry)return;if(value?.connected){finish(value);return;}}catch{/* Keep waiting through a brief network error. */}
      if(Date.now()-started>600000){finish(null);return;}
      entry.poll=setTimer?.(tick,2000)??null;
    };
    entry.poll=setTimer?.(tick,2000)??null;
    return promise;
  }
  return {login,cancel:()=>finish(null),get waiting(){return active!==null;}};
}
