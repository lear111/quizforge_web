const HUB='/api/settings/ai/hub';
// Free AI amounts are integers of 0.0001 yuan; show yuan rounded down to the cent.
export const yuan=amount=>'¥'+(Math.floor(Number(amount||0)/100)/100).toFixed(2);

// Logs this computer in to a QuizForge account for the free AI quota (Hub docs/HUB_CONNECT_AI.md 4):
// opens the Hub page in the browser and waits in a small dialog until the loopback callback lands.
export function createHubLogin({request,document=globalThis.document,openWindow=(url)=>globalThis.open?.(url,'_blank','noopener'),setTimer=globalThis.setTimeout?.bind(globalThis),clearTimer=globalThis.clearTimeout?.bind(globalThis)}){
  const get=id=>document.getElementById(`hub-login-${id}`);
  const dialog=get('dialog'),link=get('link'),wait=get('wait'),cancel=get('cancel');
  let active=null;
  function show(){if(dialog.open)return;try{dialog.showModal();}catch{dialog.setAttribute('open','');}}
  function hide(){if(!dialog.open)return;if(typeof dialog.close==='function')dialog.close();else dialog.removeAttribute('open');}
  function finish(value,cause=null){
    const entry=active;if(!entry)return;active=null;
    if(entry.poll!==null)clearTimer?.(entry.poll);hide();if(cause)entry.reject(cause);else entry.resolve(value);
  }
  cancel.addEventListener('click',()=>finish(null));
  dialog.addEventListener('cancel',event=>{event.preventDefault();finish(null);});
  dialog.addEventListener('close',()=>{if(!dialog.open&&active?.shown)finish(null);});
  // Resolves the account once logged in, or null when the user cancels or ten minutes pass.
  function login(){
    if(active)return active.promise;
    let resolve,reject;const promise=new Promise((done,fail)=>{resolve=done;reject=fail;}),entry={resolve,reject,promise,poll:null,shown:false},started=Date.now();active=entry;
    // Own the operation before the first request so cancellation and duplicate
    // callers also cover initialization, not only the later polling dialog.
    void (async()=>{
      const {authorizeUrl}=await request(`${HUB}/login`,{method:'POST',body:'{}'});if(active!==entry)return;
      link.href=authorizeUrl;wait.textContent='等待登录…';show();entry.shown=true;openWindow(authorizeUrl);
      const tick=async()=>{
        entry.poll=null;if(active!==entry)return;
        try{const value=await request(HUB);if(active!==entry)return;if(value?.connected){finish(value);return;}}catch{/* Keep waiting through a brief network error. */}
        if(Date.now()-started>600000){finish(null);return;}
        entry.poll=setTimer?.(tick,2000)??null;
      };
      entry.poll=setTimer?.(tick,2000)??null;
    })().catch(cause=>{if(active===entry)finish(null,cause);});
    return promise;
  }
  return {login,cancel:()=>finish(null),get waiting(){return active!==null;}};
}
