import {consecutiveQuestionGroups} from './outline-groups.js';
import {visibleQuestions,visibleQuestionId,hasScoreSummary,outlineStateFor} from '../practice/practice-context.js';

const renderedOutlines=new WeakMap();

export function renderOutlineView({document,pane,onNavigate,onSummary}){
  const $=selector=>document.querySelector(selector);
  const el=(tag,className,text)=>{const node=document.createElement(tag);if(className)node.className=className;if(text!=null)node.textContent=text;return node;};
  const root=$('#outline-list'),rows=visibleQuestions(pane),qid=visibleQuestionId(pane);
  const summaryAvailable=hasScoreSummary(pane),extension=pane?.view==='history'?pane.historyView.extension:pane?.collection.extension;
  // Ink, answer text and revision changes do not affect the outline. Keep its
  // nodes and keyboard focus until visible labels, navigation or states change.
  const signature=JSON.stringify([rows,extension,qid,pane?.outlineItemId,pane?.summaryShown,summaryAvailable,
    pane?.summaryShown?pane.scoreSummary?.questions:null,
    rows.map(row=>{const state=outlineStateFor(pane,row.id);return [state.status,state.result?.score,state.result?.maxScore,state.result?.gradingStatus,state.outlineStates];})]);
  const previous=renderedOutlines.get(root);
  if(previous?.pane===pane&&previous.signature===signature)return;
  root.replaceChildren();
  const roundScores=new Map(pane?.summaryShown?(pane.scoreSummary?.questions||[]).map(question=>[question.id,question]):[]);
  const statusLabels={unanswered:'未作答',draft:'已作答，待提交',pending:'已提交，待评分',correct:'正确',incorrect:'错误'};
  for(const group of consecutiveQuestionGroups(rows,extension)){
    const section=el('section','outline-group'),matrix=el('div','outline-matrix');if(group.name)section.append(el('h2','outline-group-title',group.name));section.append(matrix);root.append(section);
    for(const {question:row,number}of group.items){
    const children=row.outlineItems||[],label=String(row.outlineLabel??number),state=outlineStateFor(pane,row.id),roundScore=roundScores.get(row.id),submitted=roundScore?roundScore.submitted===true:state.status==='submitted';
    const jump=itemId=>onNavigate(row.id,itemId);
    if(children.length){
      const details=Array.isArray(roundScore?.outlineStates)?roundScore.outlineStates:roundScore&&!roundScore.submitted&&state.status==='submitted'?[]:state.outlineStates;
      const childStates=new Map((Array.isArray(details)?details:[]).filter(item=>typeof item?.id==='string'&&Object.hasOwn(statusLabels,item.status)).map(item=>[item.id,item.status]));
      for(const item of children){
        const reported=childStates.get(item.id);
        const status=submitted?(reported==='draft'?'':reported||''):reported==='draft'?'draft':'unanswered';
        const selected=row.id===qid&&pane.outlineItemId===item.id,child=el('button',`outline-item outline-child ${status}${selected?' active':''}`,item.label);
        const statusLabel=statusLabels[status]||'未提供小题状态';
        child.type='button';child.dataset.questionId=row.id;child.dataset.outlineItemId=item.id;child.title=`第 ${label} 题 · ${item.label} · ${statusLabel}`;child.setAttribute('aria-label',`第 ${label} 题，小题 ${item.label}：${statusLabel}`);child.setAttribute('aria-current',selected?'true':'false');
        child.addEventListener('click',()=>jump(item.id));matrix.append(child);
      }
      continue;
    }
    const result=roundScore||state.result;
    const draft=(roundScore?roundScore.answerState?.status??roundScore.status:state.status)==='draft';
    const status=!submitted?(draft?'draft':'unanswered'):result?.gradingStatus==='pending'?'pending':Number.isFinite(result?.score)&&Number.isFinite(result?.maxScore)&&result.score===result.maxScore?'correct':'incorrect';
    const parentActive=row.id===qid;
    const button=el('button',`outline-item ${status}${parentActive?' active':''}`,label);button.type='button';button.dataset.questionId=row.id;button.setAttribute('aria-current',parentActive?'true':'false');button.setAttribute('aria-label',`第 ${label} 题：${row.title}，${statusLabels[status]}`);button.title=`第 ${label} 题 · ${row.title} · ${statusLabels[status]}`;
    button.addEventListener('click',()=>jump(null));matrix.append(button);
    }
  }
  if(summaryAvailable){const button=el('button',`outline-score-summary${pane.summaryShown?' active':''}`,'分值汇总');button.addEventListener('click',onSummary);root.append(button);}
  renderedOutlines.set(root,{pane,signature});
}
