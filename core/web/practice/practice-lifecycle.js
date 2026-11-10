const bindings=new WeakMap();

// This adapter alone updates the existing host controls; no new UI or requests.
export function bindPracticeLifecycle({document,panes,notice,failure,updateChrome,renderRecovery}){
  bindings.get(document)?.destroy();
  const factory=document.defaultView.QuizForgeUI?.createPracticeLifecycle;
  if(!factory)throw Error('缺少界面构建文件，请运行 npm --prefix core run build:ui。');
  const status=document.getElementById('save-state');
  const manager=factory({
    start(){notice('');document.getElementById('previous').disabled=true;document.getElementById('next').disabled=true;},
    finish(){for(const pane of panes())pane.node.inert=false;updateChrome();renderRecovery();},
    error:failure,
    status(value){status.textContent=value.text;status.className=`save-state ${value.type}`;},
  });
  let destroyed=false;
  const binding={transition:manager.transition,settled:manager.settled,setWriteBusy:manager.setWriteBusy,beginWrite:manager.beginWrite,
    setSaveStatus:manager.setSaveStatus,get saveStatus(){return manager.saveStatus;},get pendingWrites(){return manager.pendingWrites;},
    destroy(){if(destroyed)return;destroyed=true;manager.destroy();if(bindings.get(document)===binding)bindings.delete(document);}};
  bindings.set(document,binding);return binding;
}
