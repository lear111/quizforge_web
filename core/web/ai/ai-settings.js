const PATH='/api/settings/ai';
const HUB=`${PATH}/hub`;

export function bindAiSettings({request,document=globalThis.document,openWindow=(url)=>globalThis.open?.(url,'_blank','noopener'),setTimer=globalThis.setTimeout?.bind(globalThis),clearTimer=globalThis.clearTimeout?.bind(globalThis)}) {
  const get=id=>document.getElementById(`ai-settings-${id}`);
  const dialog=document.getElementById('network-settings-dialog'),network=document.getElementById('network-settings-form');
  const panel=get('panel'),form=get('form'),status=get('status'),error=get('error'),report=get('report');
  const tabs=[document.getElementById('settings-network-tab'),document.getElementById('settings-ai-tab')];
  const developmentTab=document.getElementById('settings-development-tab'),developmentPanel=document.getElementById('development-settings-panel');
  const names=['enabled','autoGrade','baseUrl','model','apiKey'];
  const fields=Object.fromEntries(names.map(name=>[name,get(name)]));
  const save=get('save'),test=get('test'),close=get('close'),keyHint=get('keyHint'),testHint=get('testHint');
  const sources={official:get('source-official'),custom:get('source-custom')},officialPanel=get('official'),customPanel=get('custom');
  const account=get('account'),login=get('login'),logout=get('logout'),refresh=get('refresh');
  let current=null,hub={connected:false},busy=false,testing=false,waiting=false,epoch=0,poll=null,loginUrl='';
  const listeners=[];
  const listen=(node,event,handler)=>{node.addEventListener(event,handler);listeners.push(()=>node.removeEventListener(event,handler));};
  const source=()=>sources.official.checked?'official':'custom';
  function lock(){
    const disabled=busy||!current||current.canManage===false,official=source()==='official';
    for(const node of Object.values(fields))node.disabled=disabled;
    for(const node of Object.values(sources))node.disabled=disabled;
    save.disabled=disabled;test.disabled=disabled||official||!fields.baseUrl.value.trim()||!fields.model.value.trim();
    test.hidden=official;if(testHint)testHint.hidden=official;
    login.disabled=disabled||waiting;logout.disabled=disabled;refresh.disabled=disabled;
    officialPanel.hidden=!official;customPanel.hidden=official;
    save.textContent=busy&&!testing?'正在保存…':'保存 AI 设置';test.textContent=testing?'正在测试…':'测试模型';form.setAttribute('aria-busy',String(busy));
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
  // Official AI account line: who is logged in on this computer and today's remaining calls.
  function renderHub(value){
    hub=value||{connected:false};
    login.hidden=!!hub.connected;logout.hidden=!hub.connected;refresh.hidden=!hub.connected;
    if(waiting&&!hub.connected){
      account.textContent='已在浏览器中打开 QuizForge 登录页，完成登录并点“允许”后，这里会自动更新。';
      if(loginUrl){const link=document.createElement('a');link.href=loginUrl;link.target='_blank';link.rel='noopener';link.textContent='没有打开？点这里打开登录页';account.append(' ',link);}
      return;
    }
    if(!hub.connected){account.textContent=hub.expired?'登录已失效，请重新登录 QuizForge 账号。':'还没有登录。登录 QuizForge 账号后，即可使用官方 AI 评分。';return;}
    const who=`已登录：${hub.user?.name||''}（这台电脑：${hub.device?.name||''}）`;
    if(hub.unavailable){account.textContent=`${who}。暂时无法连接 QuizForge 服务器，查询不到剩余次数。`;return;}
    const ai=hub.ai;if(!ai){account.textContent=who;return;}
    const left=Math.max(0,(ai.dailyLimit||0)-(ai.usedToday||0));
    account.textContent=ai.enabled?`${who}。今天还可评分 ${left} 次（共 ${ai.dailyLimit} 次，0 点恢复）。`:`${who}。官方 AI 暂时不可用，可以改用自定义模型。`;
  }
  function render(value,key=''){
    current=value;
    for(const name of ['enabled','autoGrade'])fields[name].checked=Boolean(value[name]);
    for(const name of ['baseUrl','model'])fields[name].value=String(value[name]??'');
    sources[value.source==='official'?'official':'custom'].checked=true;
    fields.apiKey.value=value.canManage===false?'':key;
    keyHint.textContent=value.canManage===false?'API Key 由主机保存，仅主机可修改。':value.apiKeyConfigured?'API Key 已保存并隐藏。可直接删除或输入新值，保存后生效。':'本地模型可以不填 API Key。';
    const how=value.source==='official'?'使用官方 AI':'使用自定义模型';
    status.textContent=value.canManage===false?'请在运行 QuizForge 的电脑上配置 AI。其他设备可使用已开启的评分服务。':value.enabled?value.autoGrade?`AI 评分已开启（${how}），提交答案后自动评分，结果自动保存。`:`AI 评分已开启（${how}），可在题卡点击评分，结果自动保存。`:'AI 评分未开启，仍可人工评分。';
    renderReport(value.source==='official'?null:value.testReport);renderHub(value.hub);lock();
  }
  function stopWaiting(){waiting=false;if(poll!==null){clearTimer?.(poll);poll=null;}}
  function reset(){epoch++;stopWaiting();fields.apiKey.value='';network.hidden=false;panel.hidden=true;tabs[0].setAttribute('aria-selected','true');tabs[1].setAttribute('aria-selected','false');}
  async function loadHub(token){
    if(current?.canManage===false)return;
    const value=await request(HUB);if(token===epoch&&dialog.open)renderHub(value);return value;
  }
  async function open(){
    const token=++epoch;stopWaiting();network.hidden=true;panel.hidden=false;if(developmentPanel)developmentPanel.hidden=true;developmentTab?.setAttribute('aria-selected','false');tabs[0].setAttribute('aria-selected','false');tabs[1].setAttribute('aria-selected','true');
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
  async function saveCurrent(token){
    const key=fields.apiKey.value;
    const body={source:source(),enabled:fields.enabled.checked,autoGrade:fields.autoGrade.checked,baseUrl:fields.baseUrl.value.trim(),model:fields.model.value.trim()};
    if(key)body.apiKey=key;else body.clearApiKey=true;
    const value=await request(PATH,{method:'PUT',body:JSON.stringify(body)});
    if(token===epoch&&dialog.open)render({...value,hub},key);return value;
  }
  async function submit(event){
    event.preventDefault();if(busy||!current||current.canManage===false)return;
    error.hidden=true;const token=epoch;busy=true;status.textContent='正在保存 AI 设置…';lock();
    try{
      await saveCurrent(token);
      if(token===epoch&&dialog.open)status.textContent=source()==='official'&&fields.enabled.checked&&!hub.connected?'AI 设置已保存。请登录 QuizForge 账号后再使用官方 AI 评分。':'AI 设置已保存。';
    }
    catch(cause){if(token===epoch&&dialog.open){status.textContent='AI 设置未保存，当前修改保留，请重试。';showError(cause);}}
    finally{if(token===epoch){busy=false;lock();}}
  }
  async function check(){
    if(busy||!current||current.canManage===false||source()==='official'||!fields.baseUrl.value.trim()||!fields.model.value.trim())return;
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
  // Opens the Hub login in a new browser tab, then waits for the loopback callback.
  async function startLogin(){
    if(busy||waiting||!current||current.canManage===false)return;
    const token=epoch;error.hidden=true;
    try{
      const {authorizeUrl}=await request(`${HUB}/login`,{method:'POST',body:'{}'});
      if(token!==epoch||!dialog.open)return;
      loginUrl=authorizeUrl;openWindow(authorizeUrl);waiting=true;renderHub(hub);lock();
      const started=Date.now();
      const tick=async()=>{
        poll=null;if(token!==epoch||!dialog.open||!waiting)return;
        try{const value=await loadHub(token);if(value?.connected){stopWaiting();status.textContent='已登录 QuizForge 账号。';lock();return;}}catch{}
        if(Date.now()-started>600000){stopWaiting();renderHub(hub);lock();return;}
        poll=setTimer?.(tick,2000)??null;
      };
      poll=setTimer?.(tick,2000)??null;
    }catch(cause){if(token===epoch&&dialog.open)showError(cause);}
  }
  async function endLogin(){
    if(busy||!current||current.canManage===false)return;
    const token=epoch;busy=true;lock();
    try{const value=await request(`${HUB}/logout`,{method:'POST',body:'{}'});if(token===epoch&&dialog.open){renderHub(value);status.textContent='已退出登录。官方 AI 评分需要重新登录后才能使用。';}}
    catch(cause){if(token===epoch&&dialog.open)showError(cause);}
    finally{if(token===epoch){busy=false;lock();}}
  }
  listen(tabs[0],'click',()=>{if(busy)return;reset();});listen(tabs[1],'click',()=>{if(!busy)open();});
  if(developmentTab)listen(developmentTab,'click',()=>{epoch++;stopWaiting();fields.apiKey.value='';busy=false;testing=false;});
  listen(dialog,'close',()=>{busy=false;testing=false;reset();});listen(dialog,'cancel',()=>{busy=false;testing=false;reset();});
  for(const name of ['baseUrl','model','apiKey'])listen(fields[name],'input',()=>{renderReport(null);status.textContent='配置有修改，测试后更新检测结果。';lock();});
  for(const node of Object.values(sources))listen(node,'change',()=>{renderReport(source()==='official'?null:current?.testReport);status.textContent='评分方式有修改，保存后生效。';lock();});
  listen(login,'click',startLogin);listen(logout,'click',endLogin);listen(refresh,'click',()=>{error.hidden=true;loadHub(epoch).catch(showError);});
  listen(form,'submit',submit);listen(test,'click',check);listen(close,'click',()=>dialog.close());
  return {open,destroy(){epoch++;stopWaiting();listeners.forEach(remove=>remove());fields.apiKey.value='';}};
}
