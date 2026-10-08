const PATH='/api/settings/ai';

export function bindAiSettings({request,document=globalThis.document}) {
  const get=id=>document.getElementById(`ai-settings-${id}`);
  const dialog=document.getElementById('network-settings-dialog'),network=document.getElementById('network-settings-form');
  const panel=get('panel'),form=get('form'),status=get('status'),error=get('error');
  const tabs=[document.getElementById('settings-network-tab'),document.getElementById('settings-ai-tab')];
  const names=['enabled','baseUrl','model','apiKey','vision','outputMode','maxOutputTokens','timeoutSeconds','clearApiKey'];
  const fields=Object.fromEntries(names.map(name=>[name,get(name)]));
  const save=get('save'),test=get('test'),close=get('close'),keyHint=get('keyHint');
  let current=null,busy=false,epoch=0;
  const listeners=[];
  const listen=(node,event,handler)=>{node.addEventListener(event,handler);listeners.push(()=>node.removeEventListener(event,handler));};
  function lock(){
    const disabled=busy||!current||current.canManage===false;
    for(const node of Object.values(fields))node.disabled=disabled;
    save.disabled=disabled;test.disabled=disabled||!current?.enabled;
    save.textContent=busy?'请稍候…':'保存 AI 设置';form.setAttribute('aria-busy',String(busy));
  }
  function showError(cause){error.textContent=cause?.message||'AI 设置操作失败，请重试';error.hidden=false;}
  function render(value){
    current=value;
    for(const name of ['enabled','vision'])fields[name].checked=Boolean(value[name]);
    for(const name of ['baseUrl','model','outputMode','maxOutputTokens','timeoutSeconds'])fields[name].value=String(value[name]??'');
    fields.apiKey.value='';fields.clearApiKey.checked=false;
    keyHint.textContent=value.apiKeyConfigured?'已保存 API Key。留空保留原值；填写新值可替换。':'尚未保存 API Key。本地模型可以不填。';
    status.textContent=value.canManage===false?'请在运行 QuizForge 的电脑上配置 AI。其他设备可使用已开启的评分服务。':value.enabled?'AI 评分已开启，建议分数需确认后保存。':'AI 评分未开启，仍可人工评分。';
    lock();
  }
  function reset(){epoch++;fields.apiKey.value='';fields.clearApiKey.checked=false;network.hidden=false;panel.hidden=true;tabs[0].setAttribute('aria-selected','true');tabs[1].setAttribute('aria-selected','false');}
  async function open(){
    const token=++epoch;network.hidden=true;panel.hidden=false;tabs[0].setAttribute('aria-selected','false');tabs[1].setAttribute('aria-selected','true');
    error.hidden=true;current=null;busy=true;fields.apiKey.value='';status.textContent='正在读取 AI 设置…';lock();
    try{const value=await request(PATH);if(token===epoch&&dialog.open)render(value);}
    catch(cause){if(token===epoch&&dialog.open)showError(cause);}
    finally{if(token===epoch){busy=false;lock();}}
  }
  async function submit(event){
    event.preventDefault();if(busy||!current||current.canManage===false)return;
    error.hidden=true;
    const body={enabled:fields.enabled.checked,baseUrl:fields.baseUrl.value.trim(),model:fields.model.value.trim(),vision:fields.vision.checked,outputMode:fields.outputMode.value,maxOutputTokens:Number(fields.maxOutputTokens.value),timeoutSeconds:Number(fields.timeoutSeconds.value)};
    if(fields.apiKey.value)body.apiKey=fields.apiKey.value;
    if(fields.clearApiKey.checked)body.clearApiKey=true;
    const token=epoch;busy=true;lock();
    try{const value=await request(PATH,{method:'PUT',body:JSON.stringify(body)});if(token===epoch&&dialog.open){render(value);status.textContent='AI 设置已保存。可测试连接，或到简答题生成评分建议。';}}
    catch(cause){if(token===epoch&&dialog.open)showError(cause);}
    finally{if(token===epoch){busy=false;lock();}}
  }
  async function check(){
    if(busy||!current?.enabled||current.canManage===false)return;
    const token=epoch;busy=true;error.hidden=true;status.textContent='正在调用已保存的模型测试连接…';lock();
    try{await request(`${PATH}/test`,{method:'POST',body:'{}',timeoutMs:135000});if(token===epoch&&dialog.open)status.textContent='连接成功，模型已响应。';}
    catch(cause){if(token===epoch&&dialog.open)showError(cause);}
    finally{if(token===epoch){busy=false;lock();}}
  }
  listen(tabs[0],'click',()=>{if(busy)return;reset();});listen(tabs[1],'click',()=>{if(!busy)open();});
  listen(dialog,'close',()=>{busy=false;reset();});listen(dialog,'cancel',()=>{busy=false;reset();});
  listen(form,'submit',submit);listen(test,'click',check);listen(close,'click',()=>dialog.close());
  return {open,destroy(){epoch++;listeners.forEach(remove=>remove());fields.apiKey.value='';}};
}
