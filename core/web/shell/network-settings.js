const SETTINGS_PATH='/api/settings/network';
const REGENERATE_PATH='/api/settings/network/https/regenerate';
const QR_PREFIX='data:image/svg+xml;base64,';
const day=value=>{const date=new Date(value);return Number.isNaN(date.getTime())?'':`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;};
const PUBLIC_URL_MESSAGE='自定义地址请填写根地址，如 http://quiz.example.com:8788/ 或 http://[IPv6地址]:端口/，不包含路径、账号或查询参数。';

export function bindNetworkSettings({request,beforeSave,onSaved,document=globalThis.document,confirm=globalThis.confirm,clipboard=globalThis.navigator?.clipboard}) {
  const get=id=>document.getElementById(`network-settings-${id}`);
  const openButton=get('open'),dialog=get('dialog'),form=get('form');
  const closeButton=get('close'),cancelButton=get('cancel'),saveButton=get('save'),refreshButton=get('refresh');
  const fields=get('fields'),enabled=get('enabled'),publicEnabled=get('public-enabled'),publicUrl=get('public-url'),port=get('port'),password=get('password');
  const status=get('status'),passwordHint=get('password-hint'),error=get('error');
  const rows=Object.fromEntries(['lan','ipv6','custom','tailscale'].map(key=>[key,{urls:get(`${key}-urls`),note:get(`${key}-note`)}]));
  const https=get('https'),httpsEnabled=get('https-enabled'),httpsPort=get('https-port'),httpsStatus=get('https-status'),httpsDetails=get('https-details');
  const certificateQr=get('https-certificate-qr'),urlQr=get('https-url-qr'),certificateUrls=get('https-certificate-urls'),httpsUrls=get('https-urls'),fingerprint=get('https-fingerprint'),validity=get('https-validity'),regenerateButton=get('https-regenerate');
  let settings=null,loading=false,saving=false,refreshing=false,epoch=0;
  const listeners=[];
  const listen=(node,event,handler)=>{node.addEventListener(event,handler);listeners.push(()=>node.removeEventListener(event,handler));};
  function showError(cause) {
    const messages={LOCAL_SETTINGS_ONLY:'网络设置只能在本机修改。请在运行 QuizForge 的电脑上打开本机地址。',LAN_SETTINGS_UNAVAILABLE:'端口被占用或设置保存失败，当前连接保留。',INVALID_NETWORK_SETTINGS:'请检查连接端口、密码和自定义地址。',INVALID_PUBLIC_URL:PUBLIC_URL_MESSAGE,HTTPS_DISABLED:'请先开启并保存局域网 HTTPS。'};
    error.textContent=messages[cause?.code]||cause?.message||'设置操作失败，请重试。';
    error.hidden=false;
  }
  function lock() {
    const unavailable=loading||saving||!settings||settings.canManage===false;
    enabled.disabled=unavailable;publicEnabled.disabled=unavailable||typeof settings?.publicEnabled!=='boolean';publicUrl.disabled=publicEnabled.disabled;port.disabled=unavailable;password.disabled=unavailable;
    saveButton.disabled=unavailable;closeButton.disabled=saving;cancelButton.disabled=saving;refreshButton.disabled=unavailable||refreshing;
    httpsEnabled.disabled=unavailable||!enabled.checked;httpsPort.disabled=unavailable;regenerateButton.disabled=unavailable||!settings?.https?.enabled;
    saveButton.textContent=saving?'正在保存…':'保存设置';refreshButton.textContent=refreshing?'正在刷新…':'刷新';
    form.setAttribute('aria-busy',String(loading||saving));
  }
  function connectionStatus(next) {
    const modes=[next.enabled?'局域网':null,next.publicEnabled?'外网':null].filter(Boolean);
    return modes.length?`${modes.join('和')}连接已开启。`:'网络连接已关闭，仅本机可以访问。';
  }
  function updateRequirements() {
    password.required=Boolean((enabled.checked||publicEnabled.checked)&&!settings?.passwordConfigured);
    // HTTPS shares the LAN switch and password, so it cannot stay on without LAN access.
    if(!enabled.checked)httpsEnabled.checked=false;
    lock();
  }
  function copyButton(value) {
    const button=document.createElement('button');button.type='button';button.className='network-connection-copy';button.textContent='复制';button.setAttribute('aria-label',`复制 ${value}`);
    button.addEventListener('click',async()=>{
      try{await clipboard.writeText(value);button.textContent='已复制';}catch{button.textContent='复制失败';}
      setTimeout(()=>{button.textContent='复制';},1500);
    });
    return button;
  }
  function fill(key,values,note,{muted=false}={}) {
    const row=rows[key];row.urls.replaceChildren();
    for(const value of values.filter(item=>typeof item==='string'&&item)){
      const line=document.createElement('div');line.className='network-connection-url';
      const code=document.createElement('code');code.textContent=value;line.append(code,copyButton(value));row.urls.append(line);
    }
    row.note.textContent=note;row.note.className=muted?'is-muted':'';
  }
  // Each row lists what works now; detected addresses need no saving.
  function renderConnections(next) {
    const outside=Boolean(next.publicEnabled),off='开启“外网连接”后可用';
    // With LAN HTTPS on, list its https:// addresses instead of the plain HTTP ones.
    const secure=next.https?.enabled&&Array.isArray(next.https.urls)?next.https.urls:[];
    const lan=(secure.length?secure:next.urls||[]).filter(value=>typeof value==='string'&&!value.includes('['));
    fill('lan',next.enabled?lan:[],next.enabled?(lan.length?'手机与电脑连接同一网络':'未检测到局域网地址'):'开启“局域网连接”后可用',{muted:!next.enabled||!lan.length});
    const ipv6=(next.publicIpv6Urls||[]).filter(value=>typeof value==='string');
    const ipv6Note=next.ipv6Supported===false?'这台电脑未启用 IPv6':!ipv6.length?'未检测到本机公网 IPv6':outside?'需要光猫和电脑防火墙放行 IPv6 入站':off;
    fill('ipv6',outside?ipv6:[],ipv6Note,{muted:!outside||!ipv6.length});
    fill('custom',outside&&next.publicUrl?[next.publicUrl]:[],outside?'需要端口映射、域名或反向代理；填写后保存':off,{muted:!outside});
    const ts=next.tailscale&&typeof next.tailscale==='object'?next.tailscale:{state:'unavailable'};
    if(ts.state==='missing'||ts.state==='unavailable')fill('tailscale',[],'未检测到 Tailscale',{muted:true});
    else if(ts.state!=='running')fill('tailscale',[],'Tailscale 未运行或未登录',{muted:true});
    else fill('tailscale',outside&&ts.url?[ts.url]:[],outside?'手机登录同一 Tailscale 账号并保持连接':off,{muted:!outside||!ts.url});
  }
  function codes(list,values){list.replaceChildren();for(const value of values.filter(item=>typeof item==='string')){const line=document.createElement('code');line.textContent=value;list.append(line);}}
  function qr(image,value){const valid=typeof value==='string'&&value.startsWith(QR_PREFIX);image.hidden=!valid;if(valid)image.src=value;else image.removeAttribute?.('src');}
  function renderHttps(next) {
    const info=next.https&&typeof next.https==='object'?next.https:null;
    https.hidden=!info||next.canManage===false;if(!info)return;
    httpsEnabled.checked=Boolean(info.configured&&next.enabled);httpsPort.value=String(info.port??'');
    httpsStatus.textContent=info.enabled?'局域网 HTTPS 已开启。首次使用请按下面步骤在手机上安装并信任根证书。':info.configured?'局域网 HTTPS 已开启但端口未能启动，请换一个 HTTPS 端口后保存。':'开启后，首次会在这台电脑生成只用于 QuizForge 的本机根证书。';
    httpsDetails.hidden=!info.enabled;
    codes(certificateUrls,info.certificateUrls||[]);codes(httpsUrls,info.urls||[]);
    qr(certificateQr,info.certificateQr);qr(urlQr,info.urlQr);
    fingerprint.textContent=typeof info.fingerprint==='string'?info.fingerprint:'';
    const dates=[info.rootValidTo?`根证书有效期至 ${day(info.rootValidTo)}`:'',info.serverValidTo?`服务器证书有效期至 ${day(info.serverValidTo)}，局域网地址变化或临近到期时自动换发，手机无需重装`:''].filter(Boolean);
    validity.textContent=dates.length?dates.join('；')+'。':'';
  }
  function render(next) {
    settings=next;enabled.checked=Boolean(next.enabled);publicEnabled.checked=Boolean(next.publicEnabled);publicUrl.value=next.publicUrl||'';port.value=String(next.port);
    fields.hidden=next.canManage===false;
    status.textContent=next.canManage===false?'请在运行 QuizForge 的电脑上修改设置。':connectionStatus(next);
    passwordHint.textContent=next.passwordConfigured?'所有连接共用这个密码。留空保留原密码，填写新密码即可修改。':'所有连接共用这个密码。首次开启时请设置 8–256 个字符的密码。';
    updateRequirements();renderConnections(next);renderHttps(next);
    if(next.error)showError(new Error(next.error));
    else if(typeof next.publicEnabled!=='boolean')showError(new Error('当前服务尚不支持外网连接。请保存作答，关闭原服务并重新启动。'));
    lock();
  }
  function close() {if(saving)return;epoch++;password.value='';dialog.close();}
  async function open() {
    if(dialog.open||loading||saving)return;
    const current=++epoch;
    settings=null;loading=true;fields.hidden=true;https.hidden=true;error.hidden=true;password.value='';
    for(const row of Object.values(rows)){row.urls.replaceChildren();row.note.textContent='';}
    status.textContent='正在读取设置…';lock();dialog.showModal();
    try {
      const next=await request(SETTINGS_PATH);
      if(current===epoch&&dialog.open)render(next);
    } catch(cause) {if(current===epoch&&dialog.open){status.textContent='无法读取网络设置。';showError(cause);}}
    finally {loading=false;lock();}
  }
  // Re-detect addresses (including Tailscale) without discarding unsaved edits in the form.
  async function refresh() {
    if(loading||saving||refreshing||!settings||settings.canManage===false)return;
    const current=epoch;refreshing=true;error.hidden=true;lock();
    try {
      const next=await request(`${SETTINGS_PATH}?refresh=1`);
      if(current===epoch&&dialog.open){settings={...settings,urls:next.urls,publicIpv6Urls:next.publicIpv6Urls,tailscale:next.tailscale,ipv6Supported:next.ipv6Supported,https:next.https};renderConnections(next);renderHttps(next);}
    } catch(cause) {if(current===epoch&&dialog.open)showError(cause);}
    finally {refreshing=false;lock();}
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
    if(nextPublicUrl){
      try {
        const address=new URL(nextPublicUrl);
        if(!['http:','https:'].includes(address.protocol)||address.username||address.password||address.pathname!=='/'||address.search||address.hash)throw new Error();
      } catch {showError(new Error(PUBLIC_URL_MESSAGE));publicUrl.focus();return;}
    }
    const body={enabled:enabled.checked,publicEnabled:publicEnabled.checked,publicUrl:nextPublicUrl,port:nextPort};
    if(settings.https){
      const nextHttpsPort=Number(httpsPort.value);
      if(!Number.isInteger(nextHttpsPort)||nextHttpsPort<1024||nextHttpsPort>65535||(enabled.checked&&httpsEnabled.checked&&nextHttpsPort===nextPort)){showError(new Error('HTTPS 端口需要填写 1024–65535 之间的整数，且不能与连接端口相同。'));httpsPort.focus();return;}
      body.httpsEnabled=enabled.checked&&httpsEnabled.checked;body.httpsPort=nextHttpsPort;
    }
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
  async function regenerate() {
    if(loading||saving||!settings?.https?.enabled)return;
    if(confirm&&!confirm('重新生成根证书后，已安装旧证书的手机都要删除旧证书并重新安装新证书。确定继续吗？'))return;
    error.hidden=true;saving=true;lock();
    try {
      const next=await request(REGENERATE_PATH,{method:'POST',body:'{}'});
      render(next);if(!next.error)httpsStatus.textContent='已重新生成根证书。请在手机上删除旧的 QuizForge 证书，再按下面步骤安装新证书。';
    } catch(cause) {showError(cause);}
    finally {saving=false;lock();}
  }
  listen(openButton,'click',open);listen(regenerateButton,'click',regenerate);listen(closeButton,'click',close);listen(cancelButton,'click',close);listen(refreshButton,'click',refresh);
  listen(form,'submit',save);
  listen(enabled,'change',updateRequirements);listen(publicEnabled,'change',updateRequirements);
  listen(dialog,'cancel',event=>{if(saving)event.preventDefault();else{epoch++;password.value='';}});
  return {open,refresh,destroy(){epoch++;listeners.forEach(remove=>remove());password.value='';}};
}
