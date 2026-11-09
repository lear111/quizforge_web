// Local-only authoring UI. Server repeats every permission and format check.
export function bindBankAuthoring({request,getContext,beforeChange,onChanged,onMessage,document=globalThis.document}) {
  const $=id=>document.getElementById(id),dialog=$('bank-author-dialog'),form=$('bank-author-form');let operation=null,busy=false,revision=null,report=null;
  const error=text=>{$('bank-author-error').textContent=text;$('bank-author-error').hidden=!text;};
  function open(mode,row=null) {
    if(busy||!getContext().catalog.canManage)return;
    operation={mode,row};const opened=operation;report=null;revision=null;error('');$('bank-author-save').disabled=false;$('bank-author-report').hidden=true;$('bank-author-report-save').hidden=true;
    $('bank-author-title').textContent={create:'新建题库',copy:'另存为新题库',outline:'编辑集中大纲',upgrade:'升级本地题库'}[mode];
    $('bank-author-create').hidden=!['create','copy'].includes(mode);$('bank-author-outline').hidden=mode!=='outline';
    $('bank-author-hint').textContent=mode==='upgrade'?'升级本机所有旧格式题库与拓展示例。原目录完整备份到 .backups/qbank-format4/，逐本升级；失败项保留原样。示例升级后上传 V2 需重新审核拓展。':mode==='outline'?'仅编辑集中大纲：分组为 {group?, items}，题目项为 {question, label?} 或 {question, parts}。大纲决定显示范围和顺序；未引用的题目保留但不显示。':'从拓展示例创建题库；另存为会生成新的永久 UUID，并使用独立作答记录。';
    $('bank-author-save').hidden=false;$('bank-author-save').textContent=mode==='upgrade'?'备份并升级':'保存';
    const option=(label,value)=>new document.defaultView.Option(label,value);
    const group=$('bank-author-group');group.replaceChildren(option('未分组（根目录）',''));
    for(const name of getContext().catalog.groups?.banks??[])group.append(option(name,name)); group.value=row?.group??'';
    $('bank-author-name').value=mode==='copy'?(row?.title+' 副本'):'';
    const extension=$('bank-author-extension');extension.replaceChildren();extension.closest('label').hidden=mode!=='create';
    for(const e of getContext().catalog.extensions??[])if(!e.error)extension.append(option(`${e.group??''} / ${e.name}`,e.referencePath));
    dialog.showModal();
    if(mode==='outline') {
      $('bank-author-json').value='';$('bank-author-save').disabled=true;
      request('/api/library/outline?bank='+encodeURIComponent(row.path)).then(result=>{
        if(operation!==opened||!dialog.open)return;
        revision=result.revision;$('bank-author-json').value=JSON.stringify(result.outline,null,2);$('bank-author-questions').textContent=result.questions.map(q=>`${q.id}：${q.title}`).join('\n');$('bank-author-save').disabled=false;
      }).catch(failure=>{if(operation===opened&&dialog.open)error(failure.message);});
    }
  }
  const close=()=>{if(!busy){operation=null;dialog.close();}};
  $('bank-author-close').addEventListener('click',close);$('bank-author-cancel').addEventListener('click',close);dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
  $('library-new-bank').addEventListener('click',()=>open('create'));
  $('library-upgrade').addEventListener('click',()=>open('upgrade'));
  $('bank-author-report-save').addEventListener('click',()=>{
    if(!report)return;const url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='QuizForge-题库升级报告.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  });
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(busy||!operation)return;const {mode,row}=operation;
    let body={},endpoint=mode==='upgrade'?'/api/library/upgrade':mode==='outline'?'/api/library/outline':'/api/library/banks';
    try{
      if(mode==='outline')body={path:row.path,revision,outline:JSON.parse($('bank-author-json').value)};
      if(mode==='create'||mode==='copy')body={name:$('bank-author-name').value.trim(),group:$('bank-author-group').value,...(mode==='copy'?{source:row.path}:{extension:$('bank-author-extension').value})};
    }catch{error('大纲不是有效的 JSON，请检查后再保存。');return;}
    busy=true;error('');for(const control of form.querySelectorAll('button,input,select,textarea'))control.disabled=true;
    $('bank-author-save').textContent=mode==='upgrade'?'正在备份与升级…':'正在保存…';
    try{
      await beforeChange();const result=await request(endpoint,{method:'POST',body:JSON.stringify(body),timeoutMs:600000});
      if(mode==='upgrade'){
        const {catalog,...safeReport}=result;report=safeReport;
        $('bank-author-report').textContent=`成功 ${result.successful.length}；跳过 ${result.skipped.length}；失败 ${result.failed.length}\n备份：${result.backupDirectory}\n报告：${result.reportFile}\n`+result.failed.map(r=>`${r.path}：${r.reason}`).join('\n')+'\n需重新审核：\n'+result.affectedExtensions.map(r=>r.path).join('\n');
        $('bank-author-report').hidden=false;$('bank-author-report-save').hidden=false;$('bank-author-save').hidden=true;
        try{await onChanged(result,{kind:'bank',action:mode});}catch{error('升级报告已保留；目录中仍有无效条目，请根据失败位置修复后刷新。');}
      }else{await onChanged(result,{kind:'bank',action:mode});dialog.close();operation=null;onMessage(mode==='outline'?'集中大纲已保存。':'新题库已创建，使用新的永久 UUID。');}
    }catch(failure){error(failure.message);}
    finally{busy=false;for(const control of form.querySelectorAll('button,input,select,textarea'))control.disabled=false;$('bank-author-save').textContent=mode==='upgrade'?'备份并升级':'保存';}
  });
  return {open};
}
