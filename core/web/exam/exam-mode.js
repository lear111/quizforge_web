import {examActive,collectionFeature} from '../practice/practice-context.js';

export function examTimeLabel(exam,now=Date.now()){
  const seconds=Math.max(0,(exam.deadline?Math.ceil:Math.floor)((exam.deadline?Date.parse(exam.deadline)-now:now-Date.parse(exam.startedAt))/1000));
  const minutes=Math.floor(seconds/60),remainder=String(seconds%60).padStart(2,'0');
  return `${exam.deadline?'剩余':'已用'} ${minutes}:${remainder}`;
}
export function canStartExam(pane){return !!pane?.collection&&!pane.exam&&['bank','development-bank'].includes(pane.kind)&&collectionFeature(pane,'exam')&&pane.view==='practice';}

export function bindExamMode({document,request,active,flush,open,refresh,onError,collectionPath,makeRequestId,onDeadline,now=Date.now}){
  const factory=document.defaultView.QuizForgeUI?.mountExamUi;
  if(!factory)throw Error('缺少界面构建文件，请运行 npm --prefix core run build:ui。');
  const container=document.createElement('div');container.style.display='contents';container.id='exam-controls-root';
  document.querySelector('.document-actions').prepend(container);
  const dialog=document.createElement('dialog'),deleteDialog=document.createElement('dialog');
  dialog.className='exam-dialog';dialog.setAttribute('aria-labelledby','exam-dialog-title');
  deleteDialog.className='exam-delete-dialog';deleteDialog.setAttribute('aria-labelledby','exam-delete-title');
  document.body.append(dialog,deleteDialog);
  let source=null,command=null,busy=false,polling=false,lastPoll=0,records=[],listGeneration=0,deleteDecision=null,deadlineTimer=null,scheduledPane=null,scheduledAt=null;
  let disposed=false,errorMessage='',deleteDetail='',connectionMessage='',connectionPane=null;const offsets=new Map();
  const widget=factory({container,dialog,confirmation:deleteDialog,actions:{start:startExam,create:createExam,submit:submitExam,back:returnToPractice,close:closeSettings,resume:resumeExam,remove:removeExam,decide:decideDelete}});
  const setError=message=>{errorMessage=message||'';sync();};
  const recordTime=row=>new Date(row.startedAt).toLocaleString('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false});
  const observe=exam=>{if(exam?.serverTime)offsets.set(exam.id,Date.parse(exam.serverTime)-now());};
  function sync(){
    if(disposed)return false;
    const pane=active(),exam=pane?.exam,time=now()+(offsets.get(exam?.id)||0),expired=exam?.status==='in-progress'&&!!exam.deadline&&time>=Date.parse(exam.deadline);
    if(exam){
      if(expired&&!pane.examDeadlineReached){pane.examDeadlineReached=true;onDeadline?.(pane);}
      if(pane.frameHost)pane.frameHost.inert=expired;
      pane.whiteboard?.setReadOnly?.(expired||exam.status!=='in-progress');
    }
    const deadline=exam?.status==='in-progress'&&exam.deadline&&!expired?Date.parse(exam.deadline)-(offsets.get(exam.id)||0):null;
    if(deadline!==scheduledAt||pane!==scheduledPane||deadline!==null&&!deadlineTimer){
      clearTimeout(deadlineTimer);deadlineTimer=null;scheduledAt=deadline;scheduledPane=pane;
      if(Number.isFinite(deadline))deadlineTimer=setTimeout(()=>{deadlineTimer=null;sync();pollExam();},Math.max(0,deadline-now()));
    }
    const issue=exam?.gradingErrors?.length||exam?.aiErrors?.length;
    widget.update({busy,startHidden:!canStartExam(pane),startDisabled:busy||!!pane?.loading,
      statusHidden:!exam,status:(connectionPane===pane?connectionMessage:'')||(exam?(expired?'时间已到 · 正在自动交卷':examActive(pane)?examTimeLabel(exam,time):exam.status==='completed'?'考试已完成':issue?'评分失败，待处理':'已交卷 · 评分中'):''),
      submitHidden:!exam||exam.status==='completed'||pane?.view==='history',backHidden:!exam,
      submitLabel:expired?'正在交卷…':examActive(pane)?'交卷':issue?'重试评分':'评分中',submitDisabled:busy||!!pane?.loading||!examActive(pane)&&!issue,
      error:errorMessage,deleteDetail,rows:records.filter(row=>!['completed','deleted'].includes(row.status)).map(row=>({id:row.id,title:row.status==='in-progress'?'继续考试':'查看评分',detail:`开始于 ${recordTime(row)} · ${row.durationMinutes==null?'不限时':row.durationMinutes+' 分钟'}`,badge:row.status==='in-progress'?'进行中':row.gradingErrors?.length||row.aiErrors?.length?'评分失败':'评分中',deleteLabel:`删除 ${recordTime(row)} 的考试`}))});
    return expired;
  }
  function decideDelete(accepted){const resolve=deleteDecision;deleteDecision=null;deleteDialog.close();resolve?.(accepted);}
  const cancelDelete=event=>{event.preventDefault();decideDelete(false);};
  const closeDelete=()=>{if(!deleteDialog.open&&deleteDecision)decideDelete(false);};
  const cancelSettings=event=>{if(busy)event.preventDefault();};
  deleteDialog.addEventListener('cancel',cancelDelete);deleteDialog.addEventListener('close',closeDelete);dialog.addEventListener('cancel',cancelSettings);
  function closeSettings(){if(!disposed&&!busy)dialog.close();}
  async function resumeExam(id){
    if(disposed||busy||!dialog.open||!records.some(row=>row.id===id&&!['completed','deleted'].includes(row.status)))return;
    busy=true;sync();dialog.close();try{await open('exam',id);}catch(e){if(!disposed)onError(e);}finally{busy=false;sync();}
  }
  async function removeExam(id){
    const row=records.find(row=>row.id===id&&!['completed','deleted'].includes(row.status));if(disposed||busy||!dialog.open||!row)return;
    busy=true;deleteDetail=`${row.status==='in-progress'?'未完成考试':'待处理评分'} · ${recordTime(row)}`;setError();sync();deleteDialog.showModal();
    try{
      if(!await new Promise(resolve=>{deleteDecision=resolve;})||disposed)return;
      try{await request(`${collectionPath('exam',row.id)}/exam`,{method:'DELETE'});}catch(e){if(e.status!==404)throw e;}
      if(disposed)return;records=records.filter(record=>record.id!==row.id);
    }catch(e){
      if(disposed)return;if(e.code==='EXAM_COMPLETED')try{await loadRecords(source);}catch{}
      if(!disposed)setError(e.code==='REQUEST_TIMEOUT'?'连接超时，请重新打开考试设置确认是否已删除。':e.message);
    }finally{busy=false;sync();if(!disposed&&dialog.open)widget.focus();}
  }
  async function loadRecords(bank){const generation=++listGeneration;const value=await request(`${collectionPath(bank.kind,bank.id)}/exams`);if(disposed||source!==bank||generation!==listGeneration||!dialog.open)return;records=value.records||[];sync();}
  async function startExam(){try{
    if(disposed||busy)return;source=active();if(!canStartExam(source))return;busy=true;sync();await flush(source);if(disposed)return;command=null;records=[];setError();dialog.showModal();await loadRecords(source);
  }catch(e){if(!disposed){if(dialog.open)setError(e.message);else onError(e);}}finally{busy=false;sync();}}
  async function createExam(){if(disposed||busy||!source||!dialog.open)return;busy=true;sync();setError();try{
    const fields=widget.readFields(),minutes=fields.unlimited?null:Number(fields.duration);if(minutes!==null&&(!Number.isInteger(minutes)||minutes<1||minutes>1440))throw new Error('请输入 1–1440 分钟，或选择不限时');
    if(!command||command.durationMinutes!==minutes)command={requestId:makeRequestId(),durationMinutes:minutes};
    const value=await request(`${collectionPath(source.kind,source.id)}/exams`,{method:'POST',body:JSON.stringify(command),timeoutMs:135000});if(disposed)return;observe(value);dialog.close();await open('exam',value.id);
  }catch(e){if(!disposed){if(dialog.open)setError(e.message);else onError(e);}}finally{busy=false;sync();}}
  async function submitExam(){const pane=active();if(disposed||!pane?.exam||busy||pane.loading||pane.view==='history'||pane.exam.status==='completed')return;if(examActive(pane)&&!globalThis.confirm('交卷后将锁定全部答案，确定交卷吗？'))return;busy=true;sync();try{
    if(examActive(pane))await flush(pane);if(disposed)return;
    const value=await request(`${collectionPath('exam',pane.id)}/exam`,{method:'POST',body:JSON.stringify({requestId:makeRequestId()}),timeoutMs:135000});if(disposed)return;observe(value);await refresh(pane,value);
  }catch(e){if(!disposed)onError(e);}finally{busy=false;sync();}}
  function returnToPractice(){const exam=active()?.exam;if(!disposed&&!busy&&exam)open(exam.bankKind,exam.bankId).catch(error=>{if(!disposed)onError(error);});}
  sync();
  async function pollExam(){
    if(disposed)return;const expired=sync(),pane=active();if(!pane?.exam||pane.exam.status==='completed'||polling||busy||!expired&&now()-lastPoll<3000)return;
    polling=true;lastPoll=now();try{
      const value=await request(`${collectionPath('exam',pane.id)}/exam`);if(disposed)return;connectionMessage='';observe(value);await refresh(pane,value);
    }catch(e){if(!disposed&&active()===pane){connectionPane=pane;connectionMessage=expired?'时间已到，答案已锁定 · 正在重试交卷状态':'考试连接中断，正在重试';sync();}}finally{polling=false;}
  }
  const timer=setInterval(pollExam,1000);
  return {sync,observe,destroy(){
    if(disposed)return;disposed=true;++listGeneration;clearInterval(timer);clearTimeout(deadlineTimer);if(deleteDecision)decideDelete(false);
    deleteDialog.removeEventListener('cancel',cancelDelete);deleteDialog.removeEventListener('close',closeDelete);dialog.removeEventListener('cancel',cancelSettings);
    widget.destroy();dialog.remove();deleteDialog.remove();container.remove();
  }};
}
