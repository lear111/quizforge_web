let accessToken = sessionStorage.getItem('quizforge-access-token') || '';
// Practice without history belongs to this loaded page only. Never persist the
// token: refreshing or opening another browser page must create a new session.
const practiceSession=globalThis.crypto?.randomUUID?.()||'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,char=>{const value=globalThis.crypto?.getRandomValues?globalThis.crypto.getRandomValues(new Uint8Array(1))[0]&15:Math.floor(Math.random()*16);return (char==='x'?value:(value&3)|8).toString(16);});
const params = new URLSearchParams(location.hash.slice(1));
if (params.has('token')) { accessToken = params.get('token'); sessionStorage.setItem('quizforge-access-token', accessToken); history.replaceState(null, '', location.pathname + location.search); }
export function setAccessToken(value) { accessToken = value; sessionStorage.setItem('quizforge-access-token', value); }
export async function request(path, options = {}) {
  const {timeoutMs=12000,responseType='json',signal,...fetchOptions}=options;
  const headers = {Accept:responseType==='blob'?'application/vnd.quizforge.qbank':'application/json', ...options.headers,'X-QuizForge-Practice-Session':practiceSession};
  if (accessToken) headers['X-QuizForge-Token'] = accessToken;
  if (options.body&&!headers['Content-Type']) headers['Content-Type'] = 'application/json';
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),Math.min(135000,Math.max(1000,timeoutMs)));
  const cancel=()=>controller.abort();signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel();
  try {
    if(controller.signal.aborted)throw new Error('Request cancelled');
    const response = await fetch(path, {...fetchOptions, headers, signal:controller.signal, cache:'no-store'});
    if(response.ok&&responseType==='blob')return await response.blob();
    let result;
    try { result = await response.json(); } catch(error) {if(controller.signal.aborted)throw error;throw Object.assign(new Error('服务没有返回有效数据'), {code:'INVALID_RESPONSE'});}
    if (!response.ok) {
      if(response.status===401&&path!=='/api/auth/login')document.dispatchEvent(new Event('quizforge-auth-required'));
      throw Object.assign(new Error(result.error?.message || '操作失败'), {code:result.error?.code || 'REQUEST_FAILED',status:response.status});
    }
    return result;
  }catch(error){if(signal?.aborted)throw Object.assign(new Error('读取已取消。'),{name:'AbortError',code:'REQUEST_CANCELLED'});if(controller.signal.aborted)throw Object.assign(new Error((fetchOptions.method||'GET').toUpperCase()==='GET'?'加载等待超时，请稍后重试。':'连接等待超时，当前输入已保留，请重试保存。'),{code:'REQUEST_TIMEOUT'});throw error;}
  finally{clearTimeout(timer);signal?.removeEventListener('abort',cancel);}
}
export const collectionPath = (kind,id) => `/api/collections/${encodeURIComponent(kind)}/${encodeURIComponent(id)}`;
export const questionPath = (kind,id,qid) => `${collectionPath(kind,id)}/questions/${encodeURIComponent(qid)}`;
export function makeRequestId() { return crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`; }

export async function readResource(id,{development=false}={}) {
  if(!/^[a-f0-9]{64}$/.test(id))throw new Error('图片资源编号无效');
  const headers={'X-QuizForge-Practice-Session':practiceSession};if(accessToken)headers['X-QuizForge-Token']=accessToken;
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
  try {
    const response=await fetch(`/api/${development?'development/':''}resources/${id}`,{headers,signal:controller.signal,cache:'no-store'});
    if(!response.ok){if(response.status===401)document.dispatchEvent(new Event('quizforge-auth-required'));const value=await response.json();throw Object.assign(new Error(value.error?.message||'图片读取失败'),{code:value.error?.code,status:response.status});}
    const blob=await response.blob();
    if(blob.size>4*1024*1024)throw new Error('图片超过 4 MiB 限制');
    const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(new Error('图片读取失败'));reader.readAsDataURL(blob);});
    return {id,mime:blob.type,size:blob.size,data};
  } catch(error) {if(controller.signal.aborted)throw Object.assign(new Error('图片读取超时，请重试。'),{code:'REQUEST_TIMEOUT'});throw error;}
  finally {clearTimeout(timer);}
}
