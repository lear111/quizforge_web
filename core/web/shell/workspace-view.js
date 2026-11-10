const bindings=new WeakMap(),statuses=new WeakMap(),departedStatuses=new WeakSet();
function factory(document,name){const value=document.defaultView.QuizForgeUI?.[name];if(!value)throw Error('缺少界面构建文件，请运行 npm --prefix core run build:ui。');return value;}
export function bindSaveStatus(document){
  statuses.get(document)?.destroy();departedStatuses.delete(document);
  const widget=factory(document,'mountSaveStatus')(document.getElementById('save-state'));let disposed=false;
  const binding={update:value=>{if(!disposed)widget.update(value);},destroy(){if(disposed)return;disposed=true;widget.destroy();if(statuses.get(document)===binding){statuses.delete(document);departedStatuses.add(document);}}};
  statuses.set(document,binding);return binding;
}
export function renderSaveStatus(document,value){if(!departedStatuses.has(document))(statuses.get(document)||bindSaveStatus(document)).update(value);}

export function bindWorkspaceChrome({document,getPane,onCommand=async()=>{}}){
  bindings.get(document)?.destroy();let disposed=false,pending=false,epoch=0,signature=[],pane,model;
  const widget=factory(document,'mountWorkspaceChrome')({identity:document.querySelector('.document-identity'),actions:document.getElementById('workspace-actions-root'),progress:document.getElementById('progress-text'),notice:document.getElementById('notice'),run});
  function publish(){if(!disposed&&model)widget.update({...model,busy:model.busy||pending});}
  async function run(command){
    const owner=pane,generation=epoch,keys=signature.slice(),current=()=>!disposed&&epoch===generation&&!owner?.closed&&getPane()===owner&&keys.every((key,index)=>key===[owner,owner?.view,owner?.questionId,owner?.historyEntry][index]);
    if(!model||model.busy||pending||!current()||model[command==='draft'?'draftHidden':command==='history'?'historyHidden':'editHidden'])return;
    pending=true;publish();
    try{await onCommand(command,owner,current);}catch{/* The existing transition reports errors once. */}
    finally{if(current()){pending=false;publish();}}
  }
  const binding={update(owner,next){
    if(disposed)return;const keys=[owner,owner?.view,owner?.questionId,owner?.historyEntry];
    if(keys.some((key,index)=>key!==signature[index])){++epoch;pending=false;signature=keys;}
    pane=owner;model=next;publish();
  },notice:message=>{if(!disposed)widget.notice(String(message||''));},destroy(){if(disposed)return;disposed=true;++epoch;widget.destroy();if(bindings.get(document)===binding)bindings.delete(document);}};
  bindings.set(document,binding);
  binding.update(null,{title:'选择一本题库',group:'',progress:'',busy:false,draftHidden:true,drafting:false,draftLabel:'草稿',historyHidden:true,editHidden:true});
  return binding;
}
