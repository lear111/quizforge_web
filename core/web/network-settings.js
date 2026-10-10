const SETTINGS_PATH='/api/settings/network';

export function bindNetworkSettings({request,beforeSave,onSaved,document=globalThis.document}) {
  const get=id=>document.getElementById(`network-settings-${id}`);
  const openButton=get('open'),dialog=get('dialog'),form=get('form');
  const closeButton=get('close'),cancelButton=get('cancel'),saveButton=get('save');
  const fields=get('fields'),enabled=get('enabled'),publicEnabled=get('public-enabled'),publicFields=get('public-fields'),publicUrl=get('public-url'),port=get('port'),password=get('password');
  const status=get('status'),passwordHint=get('password-hint'),addresses=get('addresses'),urls=get('urls'),error=get('error');
  let settings=null,loading=false,saving=false,epoch=0;
  const listeners=[];
  const listen=(node,event,handler)=>{node.addEventListener(event,handler);listeners.push(()=>node.removeEventListener(event,handler));};
  function showError(cause) {
    const messages={LOCAL_SETTINGS_ONLY:'网络设置只能在本机修改。请在运行 QuizForge 的电脑上打开本机地址。',LAN_SETTINGS_UNAVAILABLE:'端口被占用或设置保存失败，当前连接保留。',INVALID_NETWORK_SETTINGS:'请检查连接端口、密码和公网地址。'};
    error.textContent=messages[cause?.code]||cause?.message||'设置操作失败，请重试。';
    error.hidden=false;
  }
  function lock() {
    const unavailable=loading||saving||!settings||settings.canManage===false;
    enabled.disabled=unavailable;publicEnabled.disabled=unavailable||typeof settings?.publicEnabled!=='boolean';publicUrl.disabled=publicEnabled.disabled;port.disabled=unavailable;password.disabled=unavailable;
    saveButton.disabled=unavailable;closeButton.disabled=saving;cancelButton.disabled=saving;
    saveButton.textContent=saving?'正在保存…':'保存设置';
    form.setAttribute('aria-busy',String(loading||saving));
  }
  function connectionStatus(next) {
    const modes=[next.enabled?'局域网':null,next.publicEnabled?'公网':null].filter(Boolean);
    return modes.length?`${modes.join('和')}连接入口已开启。`:'网络连接已关闭，仅本机可以访问。';
  }
  function updateRequirements() {
    password.required=Boolean((enabled.checked||publicEnabled.checked)&&!settings?.passwordConfigured);
    publicFields.hidden=!publicEnabled.checked;publicUrl.required=publicEnabled.checked;
  }
  function render(next) {
    settings=next;enabled.checked=Boolean(next.enabled);publicEnabled.checked=Boolean(next.publicEnabled);publicUrl.value=next.publicUrl||'';port.value=String(next.port);
    fields.hidden=next.canManage===false;
    status.textContent=next.canManage===false?'请在运行 QuizForge 的电脑上修改设置。':connectionStatus(next);
    passwordHint.textContent=next.passwordConfigured?'两种连接共用密码。留空保留原密码，填写新密码即可修改。':'两种连接共用密码。首次开启时请设置 8–256 个字符的密码。';
    updateRequirements();
    urls.replaceChildren();
    const validUrls=(next.enabled?next.urls||[]:[]).filter(value=>typeof value==='string');
    if(next.publicEnabled&&next.publicUrl)validUrls.push(next.publicUrl);
    for(const value of validUrls){const line=document.createElement('code');line.textContent=value;urls.append(line);}
    addresses.hidden=!validUrls.length;
    if(next.error)showError(new Error(next.error));
    else if(typeof next.publicEnabled!=='boolean')showError(new Error('当前服务尚不支持公网连接。请保存作答，关闭原服务并重新启动。'));
    lock();
  }
  function close() {if(saving)return;epoch++;password.value='';dialog.close();}
  async function open() {
    if(dialog.open||loading||saving)return;
    const current=++epoch;
    settings=null;loading=true;fields.hidden=true;addresses.hidden=true;urls.replaceChildren();error.hidden=true;password.value='';
    status.textContent='正在读取设置…';lock();dialog.showModal();
    try {
      const next=await request(SETTINGS_PATH);
      if(current===epoch&&dialog.open)render(next);
    } catch(cause) {if(current===epoch&&dialog.open){status.textContent='无法读取网络设置。';showError(cause);}}
    finally {loading=false;lock();}
  }
  async function save(event) {
    event.preventDefault();
    if(loading||saving||!settings||settings.canManage===false)return;
    error.hidden=true;
    const nextPort=Number(port.value),nextPassword=password.value;
    if(!Number.isInteger(nextPort)||nextPort<1024||nextPort>65535){showError(new Error('端口需要填写 1024–65535 之间的整数。'));return;}
    const hasPassword=Boolean(nextPassword.trim());
    if((hasPassword&&(nextPassword.length<8||nextPassword.length>256))||((enabled.checked||publicEnabled.checked)&&!settings.passwordConfigured&&!hasPassword)){
      showError(new Error('首次开启需要设置密码，密码长度为 8–256 个字符。'));password.focus();return;
    }
    const nextPublicUrl=publicUrl.value.trim();
    if(publicEnabled.checked){
      try {
        const address=new URL(nextPublicUrl);
        if(!['http:','https:'].includes(address.protocol)||address.username||address.password||address.pathname!=='/'||address.search||address.hash)throw new Error();
      } catch {showError(new Error('请填写完整的公网访问地址，如 https://quiz.example.com/，不包含路径或查询参数。'));publicUrl.focus();return;}
    }
    const body={enabled:enabled.checked,publicEnabled:publicEnabled.checked,publicUrl:nextPublicUrl,port:nextPort};
    if(hasPassword)body.password=nextPassword;
    saving=true;lock();
    try {
      await beforeSave?.();
      const next=await request(SETTINGS_PATH,{method:'PUT',body:JSON.stringify(body)});
      password.value='';render(next);
      if(!next.error)status.textContent=`已保存，${connectionStatus(next)}`;
      await onSaved?.(next);
    } catch(cause) {showError(cause);}
    finally {saving=false;lock();}
  }
  listen(openButton,'click',open);listen(closeButton,'click',close);listen(cancelButton,'click',close);
  listen(form,'submit',save);
  listen(enabled,'change',updateRequirements);listen(publicEnabled,'change',updateRequirements);
  listen(dialog,'cancel',event=>{if(saving)event.preventDefault();else{epoch++;password.value='';}});
  return {open,destroy(){epoch++;listeners.forEach(remove=>remove());password.value='';}};
}
