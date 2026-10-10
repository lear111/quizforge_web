// This card belongs to the host; question extensions provide scores, not this UI.
export function mountPracticeSummary(container, summary, {onFinish,onRestart,readonly=false,history=true}={}) {
  const document=container.ownerDocument;
  const element=(tag,className,text)=>{
    const node=document.createElement(tag);
    if(className)node.className=className;
    if(text!==undefined)node.textContent=text;
    return node;
  };
  const card=element('section','practice-summary-card');
  const header=element('header','practice-summary-header');
  const badge=element('span','practice-summary-badge',readonly?'历史汇总':'分值汇总');
  const title=element('h2','practice-summary-title');
  const intro=element('p','practice-summary-intro');
  header.append(badge,title,intro);
  const body=element('div','practice-summary-body');
  const scoreLabel=element('div','practice-summary-score-label','本轮得分 / 总分');
  const score=element('div','practice-summary-score');
  const earned=element('strong','practice-summary-earned');
  const separator=element('span','practice-summary-separator','/');
  const maximum=element('span','practice-summary-maximum');
  score.append(earned,separator,maximum);
  const counts=element('div','practice-summary-counts');
  const submitted=element('div','practice-summary-count');
  const pending=element('div','practice-summary-count');
  const grading=element('div','practice-summary-grading');
  counts.append(submitted,pending,grading);
  body.append(scoreLabel,score,counts);
  const footer=element('footer','practice-summary-footer');
  const note=element('p','practice-summary-note');
  const error=element('p','practice-summary-error');
  error.setAttribute('role','alert');
  error.hidden=true;
  let button=null,busy=false,destroyed=false,current=summary;
  footer.append(note,error);
  if(!readonly){
    button=element('button','practice-summary-finish');
    button.type='button';
    footer.append(button);
  }
  card.append(header,body,footer);
  container.append(card);
  const format=new Intl.NumberFormat('zh-CN',{maximumFractionDigits:6});
  const numeric=value=>Number.isFinite(Number(value))?Number(value):0;
  function render() {
    const count=Math.max(0,Math.trunc(numeric(current?.questionCount)));
    const done=Math.min(count,Math.max(0,Math.trunc(numeric(current?.submittedCount))));
    const awaiting=Math.max(0,Math.trunc(numeric(current?.pendingCount)));
    title.textContent=current?.finished?'练习结果':'本轮练习';
    intro.textContent=readonly?'查看这轮练习保存的分值统计。':'全部题目的分值汇总在这里。';
    earned.textContent=format.format(numeric(current?.score));
    maximum.textContent=format.format(numeric(current?.maxScore));
    submitted.textContent=`已提交 ${done} 题`;
    pending.textContent=`未提交 ${count-done} 题`;
    grading.hidden=!awaiting;grading.textContent=`待评分 ${awaiting} 题`;
    scoreLabel.textContent=awaiting?'已评分得分 / 总分':'本轮得分 / 总分';
    note.textContent=readonly?'此页为只读历史汇总。':current?.finished?(current.historyId?'本轮结果已保存到历史记录。':'本轮练习已完成，结果仅在当前会话保留。'):awaiting?'请返回题目确认评分，再完成练习。':!history?'结果仅在当前会话保留，刷新或关闭页面后清除。':count-done?'未提交的题目暂计 0 分，完成后保留本轮记录。':'完成练习后保留本轮结果。';
    if(button){
      button.disabled=busy||(current?.finished?typeof onRestart!=='function':awaiting>0||typeof onFinish!=='function');
      button.textContent=current?.finished?(busy?'正在开始…':typeof onRestart==='function'?'再练一次':'练习已完成'):(busy?'正在完成…':'完成练习');
      button.classList.toggle('is-busy',busy);
      button.setAttribute('aria-busy',String(busy));
    }
  }
  async function finish() {
    const restarting=Boolean(current?.finished),action=restarting?onRestart:onFinish;
    if(destroyed||busy||(!restarting&&current?.pendingCount>0)||typeof action!=='function')return;
    busy=true;error.hidden=true;render();
    try {
      const next=await action(current);
      if(destroyed)return;
      if(next)current=next;
    } catch(cause) {
      if(destroyed)return;
      error.textContent=cause?.message||(restarting?'开始新一轮失败，请重试。':'完成练习失败，请重试。');
      error.hidden=false;
    } finally {
      busy=false;
      if(!destroyed)render();
    }
  }
  if(button)button.addEventListener('click',finish);
  render();
  return {
    update(next){if(!destroyed){current=next;render();}},
    destroy(){destroyed=true;if(button)button.removeEventListener('click',finish);card.remove();}
  };
}
