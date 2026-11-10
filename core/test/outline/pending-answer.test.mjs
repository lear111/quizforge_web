import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {loadVueUi} from '../fixtures/vue-ui.mjs';
import {renderOutlineView} from '../../web/outline/outline-view.js';

test('submitted answers awaiting AI or manual grading remain pending in practice and summary outlines',t=>{
  const dom=new JSDOM('<div id="outline-list"></div>',{runScripts:'outside-only'});loadVueUi(dom);t.after(()=>dom.window.close());const document=dom.window.document;
  const row={id:'q',title:'手写作答',type:{id:'handwriting',name:'简答'}};
  const pane={view:'practice',questionId:'q',collection:{questions:[row],states:{q:{status:'submitted',result:{score:null,maxScore:5,gradingStatus:'pending'}}}}};
  const render=()=>renderOutlineView({document,pane,onNavigate(){},onSummary(){}});
  render();let button=document.querySelector('.outline-item');assert.equal(button.classList.contains('pending'),true);assert.match(button.getAttribute('aria-label'),/已提交，待评分/);assert.equal(button.classList.contains('incorrect'),false);
  pane.summaryShown=true;pane.scoreSummary={questions:[{id:'q',submitted:true,score:null,maxScore:5,gradingStatus:'pending'}]};render();assert.equal(document.querySelector('.outline-item').classList.contains('pending'),true);
  pane.summaryShown=false;pane.collection.states.q.result={score:5,maxScore:5,gradingStatus:'graded'};render();assert.equal(document.querySelector('.outline-item').classList.contains('correct'),true);
});
