import {createHubLogin} from './hub-login.js';

const PATH='/api/settings/ai';
const HUB=`${PATH}/hub`;

export function bindAiSettings({request,document=globalThis.document,login=null,openWindow,setTimer,clearTimer}) {
  const get=id=>document.getElementById(`ai-settings-${id}`);
  const hubLogin=login??createHubLogin({request,document,openWindow,setTimer,clearTimer});
  const dialog=document.getElementById('network-settings-dialog'),network=document.getElementById('network-settings-form');
  const panel=get('panel'),form=get('form'),status=get('status'),error=get('error'),report=get('report');
  const tabs=[document.getElementById('settings-network-tab'),document.getElementById('settings-ai-tab')];
  const otherTabs=[...document.querySelectorAll('.settings-tabs [role="tab"]')].filter(node=>!tabs.includes(node));
  const developmentTab=document.getElementById('settings-development-tab'),developmentPanel=document.getElementById('development-settings-panel');
  const names=['enabled','autoGrade','useOfficial','useCustom','baseUrl','model','apiKey'];
  const fields=Object.fromEntries(names.map(name=>[name,get(name)]));
  const save=get('save'),test=get('test'),close=get('close'),keyHint=get('keyHint'),testHint=get('testHint');
  const options=get('options'),customPanel=get('custom'),points=get('points');
  let current=null,hub={connected:false},busy=false,testing=false,epoch=0;
  const listeners=[];
  const listen=(node,event,handler)=>{node.addEventListener(event,handler);listeners.push(()=>node.removeEventListener(event,handler));};
  const filled=()=>Boolean(fields.baseUrl.value.trim()&&fields.model.value.trim());
  function lock(){
    const disabled=busy||!current||current.canManage===false;
    for(const node of Object.values(fields))node.disabled=disabled;
    save.disabled=disabled;test.disabled=disabled||!filled();
    options.hidden=!fields.enabled.checked;customPanel.hidden=!fields.useCustom.checked;
    save.textContent=busy&&!testing?'正在保存…':'保存';test.textContent=testing?'正在测试…':'测试模型';form.setAttribute('aria-busy',String(busy));
  }
  function showError(cause){
    const messages={AI_HOST_RESTART_REQUIRED:'后端文件已更新，请保存作答并重启应用服务，再保存 AI 设置。',AI_SETTINGS_SAVE_FAILED:'AI 设置未能保存，请重启应用服务后重试。',INTERNAL_ERROR:'AI 操作发生内部错误，请保存作答并重启应用服务后重试。'};
    error.textContent=cause?.status===404||cause?.code==='NOT_FOUND'?'当前服务未提供新版 AI 设置接口。请保存作答，关闭原启动窗口后重新启动。':messages[cause?.code]||cause?.message||'AI 设置操作失败，请重试';error.hidden=false;
  }
  function renderReport(value){
    report.replaceChildren();report.hidden=!value;if(!value)return;
    const node=(tag,className,text)=>{const result=document.createElement(tag);if(className)result.className=className;result.textContent=text;return result;};
    report.append(node('h3','', '模型测试报告'),node('p',`ai-report-summary ${value.status||''}`,value.summary||'测试已完成。'));
    const labels={passed:'通过',failed:'未通过',unknown:'无法判断',skipped:'未测试'};
    const list=document.createElement('ul');
    for(const check of value.checks||[]){
      const row=document.createElement('li');row.append(node('span','ai-report-label',check.label||''),node('span',`ai-report-badge ${check.status}`,labels[check.status]||'未知'),node('p','',check.message||''));list.append(row);
    }
    report.append(list);
    const date=new Date(value.testedAt),time=Number.isNaN(date.getTime())?'':date.toLocaleString();
    report.append(node('small','ai-report-meta',`模型：${value.model||current?.model||''} · ${time} · 用时 ${(Number(value.elapsedMs||0)/1000).toFixed(1)} 秒 · ${value.calls||0} 次请求`));
    if(value.note)report.append(node('p','ai-report-note',value.note));
  }
  // The remaining free AI points beside the free-quota choice.
  function renderHub(value){
    hub=value||{connected:false};
    let text='',empty=false,balance=false;
    if(current?.canManage===false)text=hub.connected?'已登录':'';
    else if(!hub.connected)text=hub.expired?'登录已失效':'未登录';
    else if(hub.unavailable)text='暂时查询不到余额';
    else if(!hub.ai)text='正在查询…';
    else if(!hub.ai.enabled)text='暂不可用';
    else{text=`剩余 ${hub.ai.points} 点`;empty=hub.ai.points<1;balance=true;}
    points.textContent=text;points.hidden=!text;points.classList.toggle('empty',empty);points.classList.toggle('muted',!balance);
  }
  function describe(value){
    if(value.canManage===false)return '请在运行 QuizForge 的电脑上配置 AI。其他设备可使用已开启的评分服务。';
    if(!value.enabled)return 'AI 评分未开启，仍可人工评分。';
    const sources=[value.useOfficial&&'免费 AI 额度',value.useCustom&&'自定义模型'].filter(Boolean);
    if(!sources.length)return '请选择至少一个评分来源。';
    const how=sources.length===2?'优先使用免费 AI 额度，不可用时改用自定义模型':`使用${sources[0]}`;
    return value.autoGrade?`AI 评分已开启（${how}），提交答案后自动评分，结果自动保存。`:`AI 评分已开启（${how}），可在题卡点击评分，结果自动保存。`;
  }
  function render(value,key=''){
    current=value;
    for(const name of ['enabled','autoGrade','useOfficial','useCustom'])fields[name].checked=Boolean(value[name]);
    for(const name of ['baseUrl','model'])fields[name].value=String(value[name]??'');
    fields.apiKey.value=value.canManage===false?'':key;
    keyHint.textContent=value.canManage===false?'API Key 由主机保存，仅主机可修改。':value.apiKeyConfigured?'API Key 已保存并隐藏。可直接删除或输入新值，保存后生效。':'本地模型可以不填 API Key。';
    status.textContent=describe(value);
    renderReport(value.testReport);renderHub(value.hub??hub);lock();
  }
  function reset(){epoch++;hubLogin.cancel();fields.apiKey.value='';network.hidden=false;panel.hidden=true;tabs[0].setAttribute('aria-selected','true');tabs[1].setAttribute('aria-selected','false');}
  async function loadHub(token){
    if(current?.canManage===false)return;
    const value=await request(HUB);if(token===epoch&&dialog.open)renderHub(value);return value;
  }
  async function open(){
    const token=++epoch;network.hidden=true;panel.hidden=false;if(developmentPanel)developmentPanel.hidden=true;developmentTab?.setAttribute('aria-selected','false');tabs[0].setAttribute('aria-selected','false');tabs[1].setAttribute('aria-selected','true');
    error.hidden=true;renderReport(null);current=null;busy=true;testing=false;fields.apiKey.value='';status.textContent='正在读取 AI 设置…';lock();
    try{
      const value=await request(PATH);if(token!==epoch||!dialog.open)return;
      const credential=value.canManage===false?null:await request(`${PATH}/credential`);if(token!==epoch||!dialog.open)return;
      render(value,credential?.apiKey||'');
      if(value.canManage!==false&&value.hub?.connected)loadHub(token).catch(()=>{});
    }
    catch(cause){if(token===epoch&&dialog.open)showError(cause);}
    finally{if(token===epoch){busy=false;lock();}}
  }
  // Switches and checkboxes save at once; a failed save puts the control back.
  async function patch(body,{revert,done}={}){
    if(busy||!current||current.canManage===false)return;
    const token=epoch,key=fields.apiKey.value;busy=true;error.hidden=true;status.textContent='正在保存…';lock();
    try{const value=await request(PATH,{method:'PUT',body:JSON.stringify(body)});if(token===epoch&&dialog.open){render({...value,hub},key);if(done)status.textContent=done;}}
    catch(cause){if(token===epoch&&dialog.open){revert?.();status.textContent='设置未保存，请重试。';showError(cause);}}
    finally{if(token===epoch){busy=false;lock();}}
  }
  function toggle(name){
    const node=fields[name],checked=node.checked,revert=()=>{node.checked=!checked;lock();};
    if(name==='useCustom'&&checked&&!(current?.baseUrl&&current?.model)){lock();status.textContent='填写服务地址和模型名称后点“保存”，即可使用自定义模型。';return;}
    if(name==='useCustom'&&!checked&&!current?.useCustom){lock();status.textContent=describe(current);return;}
    if(name==='useOfficial'&&checked&&!hub.connected){void loginThenEnable();return;}
    void patch({[name]:checked},{revert});
  }
  // Choosing the free quota without a login opens the login dialog first.
  async function loginThenEnable(){
    const token=epoch;error.hidden=true;status.textContent='请在浏览器中登录 QuizForge 账号…';lock();
    let account=null;
    try{account=await hubLogin.login();}
    catch(cause){if(token===epoch&&dialog.open)showError(cause);}
    if(token!==epoch||!dialog.open)return;
    if(!account?.connected){fields.useOfficial.checked=false;status.textContent='没有登录，未开启免费 AI 额度。';lock();return;}
    renderHub(account);
    await patch({useOfficial:true},{revert:()=>{fields.useOfficial.checked=false;},done:'已登录，免费 AI 额度已开启。'});
  }
  async function saveCurrent(token){
    const key=fields.apiKey.value;
    const body={enabled:fields.enabled.checked,autoGrade:fields.autoGrade.checked,useOfficial:fields.useOfficial.checked,useCustom:fields.useCustom.checked,baseUrl:fields.baseUrl.value.trim(),model:fields.model.value.trim()};
    if(key)body.apiKey=key;else body.clearApiKey=true;
    const value=await request(PATH,{method:'PUT',body:JSON.stringify(body)});
    if(token===epoch&&dialog.open)render({...value,hub},key);return value;
  }
  async function submit(event){
    event.preventDefault();if(busy||!current||current.canManage===false)return;
    error.hidden=true;const token=epoch;busy=true;status.textContent='正在保存 AI 设置…';lock();
    try{await saveCurrent(token);if(token===epoch&&dialog.open)status.textContent='AI 设置已保存。';}
    catch(cause){if(token===epoch&&dialog.open){status.textContent='AI 设置未保存，当前修改保留，请重试。';showError(cause);}}
    finally{if(token===epoch){busy=false;lock();}}
  }
  async function check(){
    if(busy||!current||current.canManage===false||!filled())return;
    const token=epoch;let saved=false;busy=true;testing=true;error.hidden=true;renderReport(null);status.textContent='正在保存当前配置…';lock();
    try{
      await saveCurrent(token);saved=true;if(token!==epoch||!dialog.open)return;
      status.textContent='正在测试文字响应、评分输出和图片识别…';renderReport(null);
      const value=await request(`${PATH}/test`,{method:'POST',body:'{}',timeoutMs:135000});
      if(token===epoch&&dialog.open){if(value.settings)render({...value.settings,hub,canManage:true},fields.apiKey.value);renderReport(value);status.textContent='模型测试已完成，结果见下方报告。';}
    }
    catch(cause){if(token===epoch&&dialog.open){status.textContent=saved?'配置已保存，但模型测试未完成。':'AI 设置未保存，模型测试未执行。';showError(cause);}}
    finally{if(token===epoch){busy=false;testing=false;lock();}}
  }
  listen(tabs[0],'click',()=>{if(busy)return;reset();});listen(tabs[1],'click',()=>{if(!busy)open();});
  for(const other of otherTabs)listen(other,'click',()=>{epoch++;hubLogin.cancel();fields.apiKey.value='';busy=false;testing=false;});
  listen(dialog,'close',()=>{busy=false;testing=false;reset();});listen(dialog,'cancel',()=>{busy=false;testing=false;reset();});
  for(const name of ['baseUrl','model','apiKey'])listen(fields[name],'input',()=>{renderReport(null);status.textContent='配置有修改，点“保存”后生效。';lock();});
  for(const name of ['enabled','autoGrade','useOfficial','useCustom'])listen(fields[name],'change',()=>toggle(name));
  listen(form,'submit',submit);listen(test,'click',check);listen(close,'click',()=>dialog.close());
  return {open,destroy(){epoch++;hubLogin.cancel();listeners.forEach(remove=>remove());fields.apiKey.value='';}};
}
