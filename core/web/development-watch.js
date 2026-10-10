// One active, visible preview polls a cheap revision. Failed writes retain its last frame.
export function createDevelopmentWatcher({check,reload,onError=()=>{},revision,document=globalThis.document,interval=1600,schedule=setTimeout,cancel=clearTimeout}){
  let current=revision,active=false,disposed=false,timer=null,running=false,epoch=0,retry=false;
  const eligible=()=>!disposed&&active&&document.visibilityState!=='hidden';
  function queue(delay=interval){if(timer!==null||running||!eligible())return;timer=schedule(()=>{timer=null;void poll();},delay);}
  async function poll(){
    if(running||!eligible())return;
    running=true;const token=epoch;
    try{
      const value=await check(),next=typeof value==='string'?value:value?.revision;
      if(!eligible()||token!==epoch)return;
      if(typeof next!=='string')throw new Error('开发版未返回有效的文件版本');
      if(next!==current||retry){const applied=await reload(next,()=>eligible()&&token===epoch);if(eligible()&&token===epoch&&applied!==false){current=next;retry=false;}}
    }catch(error){if(eligible()&&token===epoch){retry=true;onError(error);}}
    finally{running=false;queue();}
  }
  function visibility(){epoch++;if(timer!==null){cancel(timer);timer=null;}if(eligible())queue(0);}
  document.addEventListener('visibilitychange',visibility);
  return {
    setActive(value){const changed=active!==Boolean(value);active=Boolean(value);if(changed)visibility();else queue(0);},
    invalidate(){current=null;queue(0);},
    get revision(){return current;},
    destroy(){disposed=true;epoch++;if(timer!==null)cancel(timer);timer=null;document.removeEventListener('visibilitychange',visibility);},
  };
}
