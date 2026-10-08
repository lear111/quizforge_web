const clone=value=>structuredClone(value);

/** Bounded cache for JSON question payloads and extension page assets.
 * Values never share mutable references with callers. Idle entries expire even
 * without another lookup; removing a collection also fences pending loads.
 */
export function createQuestionCache({capacity=12,maxBytes=16*1024*1024,ttlMs=5*60*1000,now=Date.now,schedule=setTimeout,cancel=clearTimeout}={}) {
  for(const [name,value] of Object.entries({capacity,maxBytes,ttlMs})) {
    if(!Number.isSafeInteger(value)||value<1)throw new RangeError(`${name} must be a positive safe integer`);
  }
  if(typeof now!=='function'||(schedule!==null&&typeof schedule!=='function')||typeof cancel!=='function')throw new TypeError('Invalid cache clock or timer');
  const entries=new Map(),pending=new Map(),encoder=new TextEncoder();
  let bytes=0,timer=null;
  const checkKey=key=>{if(typeof key!=='string'||!key.length)throw new TypeError('Cache keys must be nonempty strings');};
  function removeEntry(key) {
    const entry=entries.get(key);
    if(!entry)return false;
    entries.delete(key);bytes-=entry.bytes;return true;
  }
  function expire() {
    const time=now();
    for(const [key,entry] of entries)if(time-entry.lastUsed>=ttlMs)removeEntry(key);
  }
  function syncTimer() {
    if(timer!==null){cancel(timer);timer=null;}
    if(!schedule||!entries.size)return;
    const expiry=Math.min(...Array.from(entries.values(),entry=>entry.lastUsed+ttlMs));
    timer=schedule(()=>{timer=null;expire();syncTimer();},Math.max(1,expiry-now()));
    timer?.unref?.();
  }
  function lookup(key,touch=true) {
    expire();
    const entry=entries.get(key);
    if(entry&&touch){entries.delete(key);entry.lastUsed=now();entries.set(key,entry);}
    return entry;
  }
  function snapshot(value) {
    const copied=clone(value),serialized=JSON.stringify(copied);
    if(serialized===undefined)throw new TypeError('Cached values must be JSON-compatible');
    return {value:copied,bytes:encoder.encode(serialized).byteLength,lastUsed:now()};
  }
  function insert(key,entry) {
    expire();removeEntry(key);
    if(entry.bytes>maxBytes){syncTimer();return false;}
    while(entries.size>=capacity||bytes+entry.bytes>maxBytes)removeEntry(entries.keys().next().value);
    entries.set(key,entry);bytes+=entry.bytes;syncTimer();return true;
  }
  function fence(key) {
    const load=pending.get(key);
    if(load){load.active=false;pending.delete(key);}
  }
  return {
    get(key) {
      checkKey(key);const entry=lookup(key);syncTimer();return entry?clone(entry.value):null;
    },
    set(key,value) {
      checkKey(key);const entry=snapshot(value);fence(key);return insert(key,entry);
    },
    delete(key) {
      checkKey(key);fence(key);const removed=removeEntry(key);syncTimer();return removed;
    },
    deleteCollection(prefix) {
      if(typeof prefix!=='string')throw new TypeError('Collection prefix must be a string');
      let count=0;
      for(const key of entries.keys())if(key.startsWith(prefix)){removeEntry(key);count++;}
      for(const key of pending.keys())if(key.startsWith(prefix))fence(key);
      syncTimer();return count;
    },
    clear() {
      for(const key of pending.keys())fence(key);
      entries.clear();bytes=0;syncTimer();
    },
    async load(key,loader,{revalidate=false}={}) {
      checkKey(key);
      if(typeof loader!=='function')throw new TypeError('Cache loader must be a function');
      const existing=pending.get(key);
      if(existing)return clone(await existing.promise);
      const cached=lookup(key);syncTimer();
      if(cached&&!revalidate)return clone(cached.value);
      const load={active:true,promise:null};
      load.promise=Promise.resolve().then(()=>loader(cached?clone(cached.value):null)).then(value=>{
        // A confirmed write wins over an older GET. Deletes/close/refresh never
        // let a late network reply recreate the released cache entry.
        if(!load.active){const latest=lookup(key,false);syncTimer();return latest?latest.value:clone(value);}
        const entry=snapshot(value);insert(key,entry);return entry.value;
      }).finally(()=>{if(pending.get(key)===load)pending.delete(key);});
      pending.set(key,load);
      return clone(await load.promise);
    },
    stats() {
      expire();syncTimer();return {size:entries.size,bytes,inflight:pending.size};
    }
  };
}
