import {visibleQuestions,navigationIndex,hasScoreSummary} from './practice-context.js';
import {navigationShortcut} from './question-navigation.js';

const bindings=new WeakMap();
export function bindPracticeNavigation({document,active,transitionTo,navigateQuestion,navigateOutlineTarget,showScoreSummary,renderOutline,closeDrawers,draftViewActive}){
  bindings.get(document)?.destroy();
  const factory=document.defaultView.QuizForgeUI?.createPracticeNavigation;
  if(!factory)throw Error('缺少界面构建文件，请运行 npm --prefix core run build:ui。');
  const manager=factory({
    read(){
      const pane=active();if(!pane||pane.closed)return null;
      // Practice/edit/summary belong to one live round. Frozen history entries
      // have their own scope even when they reuse this same host pane.
      const scope=JSON.stringify([pane.view==='history'?'history':pane.view==='history-deleted'?'history-deleted':'live',pane.view==='history'?pane.historyEntry?.id:null]);
      return {owner:pane,scope,ids:visibleQuestions(pane).map(row=>row.id),index:navigationIndex(pane),summaryAvailable:hasScoreSummary(pane)};
    },
    enqueue:transitionTo,
    question:(pane,id)=>navigateQuestion(pane,id),
    jump:async(pane,id,itemId)=>{await navigateOutlineTarget(pane,id,itemId,{navigateQuestion,renderOutline});closeDrawers();},
    summary:async pane=>{await showScoreSummary(pane);closeDrawers();},
  });
  const step=offset=>{void manager.step(offset).catch(()=>{});};
  const previous=document.getElementById('previous'),next=document.getElementById('next');
  const back=()=>step(-1),forward=()=>step(1);
  const keydown=event=>{const pane=active();if(!pane||pane.closed||pane.richtextFrame)return;const offset=navigationShortcut(event,{document,draft:draftViewActive(pane)});if(!offset)return;event.preventDefault();step(offset);};
  previous.addEventListener('click',back);next.addEventListener('click',forward);document.addEventListener('keydown',keydown);
  let destroyed=false;
  const view={sync:manager.sync,step:manager.step,jump:manager.jump,summary:manager.summary,destroy(){if(destroyed)return;destroyed=true;manager.destroy();previous.removeEventListener('click',back);next.removeEventListener('click',forward);document.removeEventListener('keydown',keydown);if(bindings.get(document)===view)bindings.delete(document);}};
  bindings.set(document,view);return view;
}
