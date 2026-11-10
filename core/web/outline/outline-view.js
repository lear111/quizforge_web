import {consecutiveQuestionGroups} from './outline-groups.js';
import {visibleQuestions,visibleQuestionId,hasScoreSummary,outlineStateFor} from '../practice/practice-context.js';

const views=new WeakMap();
export function renderOutlineView({document,pane,onNavigate,onSummary}){
  const root=document.querySelector('#outline-list'),ui=document.defaultView.QuizForgeUI;
  if(!ui?.renderOutline)throw Error('缺少界面构建文件，请运行 npm --prefix core run build:ui。');
  let view=views.get(root);
  if(!view)root.replaceChildren();
  if(!view||view.pane!==pane){view={pane,identity:Symbol('outline')};views.set(root,view);}
  const token={};view.token=token;
  const current=()=>views.get(root)===view&&view.token===token&&!pane?.closed;
  const rows=visibleQuestions(pane),extension=pane?.view==='history'?pane.historyView.extension:pane?.collection.extension;
  const rounds=new Map(pane?.summaryShown?(pane.scoreSummary?.questions||[]).map(row=>[row.id,row]):[]);
  // Take only display fields; never pass the mutable pane, answers or ink to Vue.
  const result=value=>value?{score:value.score,maxScore:value.maxScore,gradingStatus:value.gradingStatus}:null;
  const children=items=>Array.isArray(items)?items.filter(item=>typeof item?.id==='string').map(item=>({id:item.id,status:item.status})):undefined;
  const input={questionId:visibleQuestionId(pane),itemId:pane?.outlineItemId,summaryShown:!!pane?.summaryShown,summaryAvailable:hasScoreSummary(pane),
    groups:consecutiveQuestionGroups(rows,extension).map(group=>({key:group.items[0].question.id,name:group.name,questions:group.items.map(({question:row,number})=>{
      const state=outlineStateFor(pane,row.id),round=rounds.get(row.id);
      return {id:row.id,title:row.title,label:String(row.outlineLabel??number),children:(row.outlineItems||[]).map(item=>({id:item.id,label:item.label})),
        state:{status:state.status,result:result(state.result),outlineStates:children(state.outlineStates)},
        round:round?{...result(round),submitted:round.submitted,status:round.status,answerState:round.answerState?{status:round.answerState.status}:undefined,outlineStates:children(round.outlineStates)}:undefined};
    })}))};
  ui.renderOutline({container:root,identity:view.identity,input,onNavigate:(qid,itemId)=>{if(current())return onNavigate(qid,itemId);},onSummary:()=>{if(current())return onSummary();}});
}
export function destroyOutlineView(document){
  const root=document.querySelector('#outline-list');if(!root)return;
  views.delete(root);document.defaultView.QuizForgeUI?.unmountOutline(root);
}
