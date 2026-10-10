// Extensions trigger grading; the host owns inputs, persistence and revisions.
export function createAiClient({request,path,makeRequestId,settled,onConfirmed,confirmations=new Map(),shouldRefreshTask=()=>false}) {
  const taskPath=id=>{
    if(typeof id!=='string'||! /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(id))throw new Error('评分任务编号无效');
    return `${path}/ai/tasks/${encodeURIComponent(id)}`;
  };
  const post=async(url,body,key)=>{
    let id=key&&confirmations.get(key);
    if(!id){id=makeRequestId();if(key){confirmations.set(key,id);while(confirmations.size>8)confirmations.delete(confirmations.keys().next().value);}}
    await settled();
    const value=await request(url,{method:'POST',body:JSON.stringify({...body,requestId:id})});
    if(key)confirmations.delete(key);
    return value;
  };
  return async(method,args={},contentVersion)=>{
    let data;
    if(method==='ai-grade')data=await post(`${path}/ai/grade`,{contentVersion,force:args.force===true});
    else if(method==='ai-task'){
      data=await request(args.taskId?taskPath(args.taskId):`${path}/ai/current`);
    }
    else if(method==='ai-retry')data=await post(`${taskPath(args.taskId)}/retry`,{});
    else if(method==='ai-confirm'){
      if(args.score!==undefined&&(typeof args.score!=='number'||!Number.isFinite(args.score)))throw new Error('评分分数无效');
      const body={};if(args.score!==undefined)body.score=args.score;
      if(typeof args.candidateVersion==='string')body.candidateVersion=args.candidateVersion;
      const key=JSON.stringify([path,args.taskId,body.candidateVersion,body.score]);
      data=await post(`${taskPath(args.taskId)}/confirm`,body,key);
      if(data.payload)onConfirmed(data.payload);
    }else throw new Error('评分操作不可用');
    if(method!=='ai-confirm'){
      const task=method==='ai-task'&&!args.taskId?data.task:data;
      if(task?.status==='confirmed'&&shouldRefreshTask(task))onConfirmed(await request(path));
    }
    return {ok:true,data};
  };
}
