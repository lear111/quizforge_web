export const MAX_NETWORK_AUDIO_BYTES = 64 * 1024 * 1024;
const cancelled = () => Object.assign(new Error('听力材料读取已取消。'), {name:'AbortError'});
const audioTypes = new Set(['audio/mpeg','audio/mp3','audio/wav','audio/x-wav','audio/wave','audio/ogg','audio/mp4','audio/x-m4a']);

// Do not use the authenticated host API helper for third-party requests.
export async function readNetworkAudio(url, {signal, fetchImpl=globalThis.fetch, timeoutMs=120000, maxBytes=MAX_NETWORK_AUDIO_BYTES, reload=false}={}) {
  let address;
  try {
    address=new URL(url);
    if(address.protocol!=='https:'||address.username||address.password||/[\s\\\x00-\x1f\x7f#]/.test(url))throw new Error();
  } catch { throw new Error('网络听力材料需要有效的 HTTPS 音频地址。'); }
  const controller=new AbortController();let timedOut=false,reader=null,body=null,complete=false,rejectInterrupted;
  const interrupted=new Promise((resolve,reject)=>{rejectInterrupted=()=>reject(cancelled());});
  controller.signal.addEventListener('abort',rejectInterrupted,{once:true});
  const cancel=()=>controller.abort();signal?.addEventListener('abort',cancel,{once:true});
  const timer=setTimeout(()=>{timedOut=true;controller.abort();},timeoutMs);
  try {
    if(signal?.aborted)throw cancelled();
    const pending=Promise.resolve(fetchImpl(address.href,{
      method:'GET',mode:'cors',credentials:'omit',redirect:'error',referrerPolicy:'no-referrer',
      headers:{Accept:'audio/*'},cache:reload?'reload':'default',signal:controller.signal
    })).then(response=>{
      if(controller.signal.aborted){void response.body?.cancel().catch(()=>{});throw cancelled();}
      return response;
    });
    const response=await Promise.race([pending,interrupted]);body=response.body;
    if(response.status!==200)throw new Error('网络听力材料读取失败，请重试。');
    const mime=(response.headers.get('Content-Type')||'').split(';')[0].trim().toLowerCase();
    if(!audioTypes.has(mime))throw new Error('网络材料不是支持的音频格式，请检查资源服务的 Content-Type。');
    const declared=response.headers.get('Content-Length');
    if(declared!==null&&(!/^\d+$/.test(declared)||Number(declared)>maxBytes))throw new Error('网络听力材料超过大小上限（64 MiB）。');
    if(!body?.getReader)throw new Error('网络听力材料无法读取，请重试。');
    reader=body.getReader();const chunks=[];let total=0;
    for(;;){
      const {done,value}=await Promise.race([reader.read(),interrupted]);
      if(done)break;
      total+=value.byteLength;
      if(total>maxBytes)throw new Error('网络听力材料超过大小上限（64 MiB）。');
      chunks.push(value);
    }
    if(!total)throw new Error('网络听力材料为空，请检查资源地址。');
    if(controller.signal.aborted)throw cancelled();
    complete=true;return new Blob(chunks,{type:mime});
  } catch(error) {
    if(signal?.aborted)throw cancelled();
    if(timedOut)throw new Error('网络听力材料读取超时，请重试。');
    if(error instanceof TypeError)throw new Error('无法读取网络听力材料，请检查网络和资源服务的跨域（CORS）设置。');
    throw error;
  } finally {
    clearTimeout(timer);signal?.removeEventListener('abort',cancel);controller.signal.removeEventListener('abort',rejectInterrupted);
    if(!complete){controller.abort();if(reader)void reader.cancel().catch(()=>{});else if(body)void body.cancel().catch(()=>{});}
    reader?.releaseLock();
  }
}
