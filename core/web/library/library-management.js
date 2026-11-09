export function bindLibraryManagement({request,getContext,beforeChange,onChanged,onExport,onCopy,onOutline}){
  const $=selector=>document.querySelector(selector),dialog=$('#library-manage-dialog'),form=$('#library-manage-form');
  let operation=null,subject=null,returnEdit=null,busy=false;
  const close=()=>{if(!busy)dialog.close();};
  const cancel=()=>{
    if(busy)return;
    if(returnEdit){const previous=returnEdit;open(previous.target,previous.row);$('#library-manage-name').value=previous.name;$('#library-manage-group').value=previous.group;}
    else close();
  };
  $('#library-manage-close').addEventListener('click',close);$('#library-manage-cancel').addEventListener('click',cancel);
  dialog.addEventListener('cancel',event=>{event.preventDefault();cancel();});
  const error=message=>{$('#library-manage-error').textContent=message;$('#library-manage-error').hidden=!message;};
  const status=message=>{$('#library-manage-status').textContent=message;$('#library-manage-status').hidden=!message;};
  const setBusy=value=>{busy=value;form.setAttribute('aria-busy',String(value));for(const control of form.querySelectorAll('button,input,select'))control.disabled=value;};
  function open(target,row,action='update'){
    const {kind,catalog}=getContext();if(busy||!catalog.canManage||kind==='extension'&&action==='create')return;
    operation={kind,target,action,path:row?.path||''};subject={...row};returnEdit=null;
    const type=target==='group'?(kind==='extension'?'拓展分组':'分组'):kind==='bank'?'题库':'拓展',removing=action==='delete',creatingGroup=target==='group'&&action==='create',readOnly=kind==='extension'&&!removing;
    $('#library-manage-title').textContent=`${removing?'删除':action==='create'?'新建':readOnly?'管理':'编辑'}${type}`;
    $('#library-manage-name').value=target==='group'?(row?.name||''):(row?.title||row?.name||'');
    $('#library-manage-fields').hidden=removing||readOnly;$('#library-manage-confirm').hidden=readOnly;$('#library-manage-confirm').textContent=removing?'移入回收目录':'保存';
    $('#library-manage-confirm').classList.toggle('danger-button',removing);
    const hint=removing?`${row?.title||row?.name||row?.path}：${target==='group'?'此分组及其全部内容（包括未显示的文件）':'此'+type}将移入 .trash/library 回收目录，作答与历史数据保留。${kind==='extension'?'仍有题库引用时无法删除。':''}`:target==='group'?'分组名就是文件夹名；改名不会重置作答与历史。':'名称对应实际文件夹或文件名，移动或改名不会重置作答与历史。';
    $('#library-manage-hint').textContent=readOnly?`${row?.name||row?.title||row?.path}：拓展按实际路径引用，不支持改名或移动。可在下方删除；仍有题库引用时无法删除。`:hint+(removing&&kind==='bank'?' 配套拓展文件会保留，不随题库删除。':'');
    $('#library-manage-more').hidden=action!=='update';$('#library-manage-export').hidden=kind!=='bank'||!onExport;$('#library-manage-export').textContent=target==='group'?'导出分组':'导出题库';
    for(const key of ['copy','outline']){const button=$(`#library-manage-${key}`);if(button)button.hidden=kind!=='bank'||target!=='item'||action!=='update';}
    $('#library-manage-cancel').textContent=readOnly?'关闭':'取消';
    const select=$('#library-manage-group');select.closest('label').hidden=target==='group';$('#library-manage-cancel').hidden=creatingGroup;select.replaceChildren(new Option('未分组（根目录）',''));
    for(const path of catalog.groups?.[kind==='bank'?'banks':'extensions']||[]){
      if(target==='group'||path.includes('/')||path.includes('\\'))continue;
      select.append(new Option(path,path));
    }
    select.value=target==='group'?'':row?.group||'';error('');status('');if(!dialog.open)dialog.showModal();
    (removing?$('#library-manage-cancel'):readOnly?$('#library-manage-cancel'):$('#library-manage-name')).focus();
  }
  $('#library-manage-delete').addEventListener('click',()=>{
    if(busy||operation?.action!=='update')return;
    const previous={target:operation.target,row:subject,name:$('#library-manage-name').value,group:$('#library-manage-group').value};
    open(previous.target,previous.row,'delete');returnEdit=previous;
  });
  for(const [key,callback]of [['copy',onCopy],['outline',onOutline]])$(`#library-manage-${key}`)?.addEventListener('click',()=>{if(busy||operation?.target!=='item')return;dialog.close();callback?.(subject);});
  $('#library-manage-export').addEventListener('click',async()=>{
    if(busy||operation?.action!=='update'||operation.kind!=='bank'||!onExport)return;
    setBusy(true);error('');status('正在导出已保存的内容…');
    try{if(await onExport(subject,operation.target)===false)throw new Error('正在导入或导出，请稍后重试。');status('已导出当前保存的内容。');}
    catch(failure){status('');error(failure.message);}
    finally{setBusy(false);}
  });
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(busy||!operation||operation.kind==='extension'&&operation.action!=='delete')return;const value={...operation};
    if(value.action!=='delete'){value.name=$('#library-manage-name').value.trim();value.group=value.target==='group'?'':$('#library-manage-group').value;if(!value.name){error('请输入名称');return;}}
    setBusy(true);error('');status('');
    try{await beforeChange(value);const result=await request('/api/library/manage',{method:'POST',body:JSON.stringify(value),timeoutMs:60000});await onChanged(result,value);dialog.close();}
    catch(failure){error(failure.message);}
    finally{setBusy(false);}
  });
  return {open};
}
