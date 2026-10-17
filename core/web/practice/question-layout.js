// Old drafts have no layout metadata: preserve their original card coordinates.
export const LEGACY_DRAFT_LAYOUT = Object.freeze({width:760,padding:26,top:34});
const DRAFT_VIEW_GUTTER=24;
export function syncQuestionLayout(pane, draft) {
  if (draft && pane.draftLayoutPending && !pane.loading && pane.view==='practice') {
    // New drafts use device-independent logical coordinates. Existing layout
    // metadata is retained so older annotations keep their alignment.
    if (pane.whiteboard.initializeLayout(LEGACY_DRAFT_LAYOUT.width)) pane.draftLayoutPending=false;
  }
  const layout=(pane.whiteboard.getLayout ? pane.whiteboard.getLayout() : pane.whiteboard.getDraft?.()?.layout)||LEGACY_DRAFT_LAYOUT;
  pane.world.style.setProperty('--qf-draft-width',`${layout.width}px`);
  pane.world.style.setProperty('--qf-draft-padding',`${layout.padding}px`);
  pane.world.style.setProperty('--qf-draft-top',`${layout.top}px`);
  pane.whiteboard.setViewCamera({x:0,y:0,zoom:1});
  if (draft) applyDraftView(pane, layout); else pane.draftViewApplied=null;
  return layout;
}

// The draft camera is a per-device display choice and is never saved. Every
// question opens at the same home view: the card centred horizontally and
// fitted to the width. Pan, zoom and scroll then stay per question for the
// session, so switching away and back returns to the same place.
export function draftHomeView(width, layout) {
  const zoom=Math.max(.25,Math.min(1,(width-DRAFT_VIEW_GUTTER)/layout.width));
  return {x:(width/zoom-layout.width)/2,y:Math.max(0,DRAFT_VIEW_GUTTER-layout.top*zoom)/zoom,zoom};
}
function draftViewKey(pane) {
  return pane.view==='history'?`history:${pane.historyEntry?.id}:${pane.historyQuestionId}`:`question:${pane.questionId}`;
}
function draftViewEntry(pane) {
  const views=pane.draftViews??=new Map(), key=draftViewKey(pane);
  if (!views.has(key)) views.set(key,{camera:null,scrollTop:0,home:''});
  return views.get(key);
}
function applyDraftView(pane, layout) {
  const board=pane.whiteboard, width=pane.viewport.clientWidth, entry=draftViewEntry(pane);
  const generation=board.loadGeneration ?? 0, key=draftViewKey(pane), applied=pane.draftViewApplied;
  const fresh=!applied || applied.board!==board || applied.generation!==generation || applied.key!==key;
  // A home view follows the width and a newly frozen layout until the user moves it.
  const homeKey=`${width}:${layout.width}:${layout.top}`, home=!entry.camera && entry.home!==homeKey;
  if (!fresh && !home) return;
  entry.home=homeKey;
  board.setViewport(entry.camera || draftHomeView(width, layout), {emit:false});
  if (fresh) pane.draftScrollRestore=entry.scrollTop;
  pane.draftViewApplied={board,generation,key};
}
function currentDraftView(pane) {
  const applied=pane.draftViewApplied;
  return applied && applied.board===pane.whiteboard && applied.key===draftViewKey(pane) ? draftViewEntry(pane) : null;
}
export function rememberDraftView(pane, camera) {
  const entry=currentDraftView(pane);
  if (entry) entry.camera={...camera};
}
export function rememberDraftScroll(pane) {
  const entry=currentDraftView(pane);
  if (entry && !pane.loading && pane.draftScrollRestore==null) entry.scrollTop=pane.viewport.scrollTop;
}
