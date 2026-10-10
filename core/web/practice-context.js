// Pure view state: shared by the shell, outline, and extension bridge.
export const collectionFeature=(pane,name)=>pane?.collection?.features?.[name]!==false;
export const canEditCollection=pane=>!!pane&&collectionFeature(pane,'editing');
export const practiceSaveLabel=pane=>collectionFeature(pane,'history')?'已保存':'当前会话';
export function canViewDraft(pane){
  if(!pane||pane.summaryShown)return false;
  return pane.view==='history'?!!pane.historyQuestion?.payload&&pane.historyEntry?.collection?.features?.whiteboard!==false:pane.view==='practice'&&!!pane.payload&&collectionFeature(pane,'whiteboard');
}
export function draftViewActive(pane){return canViewDraft(pane)&&!!(pane.view==='history'?pane.historyDraftMode:pane.draftMode);}
export function visibleQuestions(pane){return pane?.view==='history-deleted'?[]:pane?.view==='history'?pane.historyView?.questions||[]:pane?.collection.questions||[];}
export function visibleQuestionId(pane){return pane?.summaryShown?null:pane?.view==='history'?pane.historyQuestionId:pane?.questionId;}
export function hasScoreSummary(pane){return !!pane&&(pane.view==='history'?!!pane.historyEntry?.summary:['practice','summary'].includes(pane.view));}
export function navigationIndex(pane){const rows=visibleQuestions(pane);return pane?.summaryShown?rows.length:rows.findIndex(q=>q.id===visibleQuestionId(pane));}
export function stateFor(pane,qid){return (pane.view==='history'?pane.historyView?.states:pane.collection.states)?.[qid]||{status:'unanswered',answer:null,result:null,revision:0};}
export function contextFor(pane){const history=pane.view==='history',value=history?pane.historyQuestion.payload:pane.payload,state=value.state;return {mode:history?'history':['extension','development'].includes(pane.kind)?'example':'practice',...(pane.development?{development:{folder:pane.development.folder}}:{}),question:value.question,answer:state.answer,result:state.result,status:state.status,aiTask:history?null:value.aiTask,capabilities:{canSave:!history&&state.status!=='submitted',canSubmit:!history&&state.status!=='submitted',canRetry:!history&&state.status==='submitted',canReview:!history&&value.capabilities?.canReview===true,canAiGrade:!history&&value.capabilities?.canAiGrade===true,canEdit:!history&&canEditCollection(pane),canWhiteboard:!history&&collectionFeature(pane,'whiteboard'),canHistory:!history&&collectionFeature(pane,'history')}};}
