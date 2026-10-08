const scope = action => action === 'whiteboard' ? 'whiteboard' : 'answer';

export function createDraftBuffer(){
  let generation=0,pending=null;
  return {
    get pending(){return pending!==null;},
    replace(value){generation++;pending=structuredClone(value);},
    take(){if(pending===null)return null;const snapshot={generation,value:pending};pending=null;return snapshot;},
    restore(snapshot){if(snapshot.generation!==generation||pending!==null)return false;pending=structuredClone(snapshot.value);return true;},
    clear(){generation++;pending=null;}
  };
}

// A successful whiteboard write cannot acknowledge an unsaved answer, or vice versa.
export function createWriteQueue({send,revisionFor,makeRequestId,onSaved=()=>{},onFailed=()=>{},onBusy=()=>{}}) {
  let tail=Promise.resolve();
  const failures=new Map();
  function enqueue(questionId,action,data,{contentVersion}={}) {
    const snapshot=structuredClone(data),requestId=makeRequestId(),key=`${questionId}:${scope(action)}`;
    const run=tail.then(async()=>{
      onBusy(true);
      try {
        const body={requestId,revision:revisionFor(questionId),action,data:snapshot};
        if(contentVersion)body.contentVersion=contentVersion;
        let value;
        try {value=await send(questionId,body);}
        catch(error) {if(!(error instanceof TypeError))throw error;value=await send(questionId,body);}
        failures.delete(key);
        await onSaved(questionId,action,value);
        return value;
      } catch(error) {
        failures.set(key,{questionId,action,data:snapshot,contentVersion,error});
        await onFailed(questionId,action,error);
        throw error;
      } finally {onBusy(false);}
    });
    tail=run.catch(()=>{});
    return run;
  }
  return {
    enqueue,
    settled:()=>tail,
    get hasFailures(){return failures.size>0;},
    get failures(){return [...failures.values()];},
    clear:()=>failures.clear()
  };
}
