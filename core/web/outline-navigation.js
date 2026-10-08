import {visibleQuestions,visibleQuestionId} from './practice-context.js';

// Child items are locations inside a parent question, never extra answers/scores.
export async function navigateOutlineTarget(pane,questionId,itemId,{navigateQuestion,renderOutline}={}){
  const row=visibleQuestions(pane).find(question=>question.id===questionId);
  if(!row||itemId!=null&&!row.outlineItems?.some(item=>item.id===itemId))
    throw new Error('题目大纲中没有对应位置，请刷新题库后重试');
  if(pane.closed)throw new Error('标签页已关闭');
  if(visibleQuestionId(pane)!==questionId||!pane.plugin)await navigateQuestion(pane,questionId);
  if(pane.closed||visibleQuestionId(pane)!==questionId||!pane.plugin)
    throw new Error('题目页面已切换，无法定位小题');
  const plugin=pane.plugin;
  if(itemId!=null){
    // The parent transition may have made its container inert while flushing.
    // Release it before the extension tries to focus a field inside the iframe.
    pane.node.inert=false;
    await plugin.navigateOutline(itemId);
    if(pane.closed||pane.plugin!==plugin||visibleQuestionId(pane)!==questionId)
      throw new Error('题目页面已切换，无法定位小题');
  }
  pane.outlineItemId=itemId??null;
  renderOutline();
}
