import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {JSDOM} from 'jsdom';
import {loadVueUi} from '../fixtures/vue-ui.mjs';
import {bindPracticeNavigation} from '../../web/practice/practice-navigation.js';
import {adjacentQuestionIds,navigationShortcut,scheduleIdle} from '../../web/practice/question-navigation.js';
import {createQuestionCache} from '../../web/practice/question-cache.js';
import {visibleQuestions,navigationIndex,hasScoreSummary} from '../../web/practice/practice-context.js';
import {questionExtension,collectionHasExtension,extensionPageRoute} from '../../web/bridge/extension-pages.js';

const source=readFileSync(new URL('../../web/app.js',import.meta.url),'utf8');
const part=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end));
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('adjacent questions list the next card before the previous one',()=>{
  const rows=['a','b','c','d'].map(id=>({id}));
  assert.deepEqual(adjacentQuestionIds(rows,1),['c','a']);
  assert.deepEqual(adjacentQuestionIds(rows,0),['b']);
  assert.deepEqual(adjacentQuestionIds(rows,3),['c']);
  assert.deepEqual(adjacentQuestionIds(rows,1,2),['c','a','d']);
  assert.deepEqual(adjacentQuestionIds(rows,4),['d'],'The summary slot prefetches the last question');
  assert.deepEqual(adjacentQuestionIds(rows,-1),[]);
});

test('arrow shortcuts leave editable fields, dialogs, modifiers and draft mode alone',t=>{
  const dom=new JSDOM(`<body><button id="plain">x</button><input id="field"><div contenteditable="true" id="rich"></div><div role="separator" id="handle" tabindex="0"></div><div class="qf-whiteboard-tool-row"><button id="tool">t</button></div><dialog id="dialog"><button id="inside">i</button></dialog></body>`);
  t.after(()=>dom.window.close());
  const document=dom.window.document;
  const key=(id,init)=>{const event=new dom.window.KeyboardEvent('keydown',{bubbles:true,cancelable:true,...init});Object.defineProperty(event,'target',{value:document.getElementById(id)});return event;};
  assert.equal(navigationShortcut(key('plain',{key:'ArrowRight'}),{document}),1);
  assert.equal(navigationShortcut(key('plain',{key:'ArrowLeft'}),{document}),-1);
  assert.equal(navigationShortcut(key('plain',{key:'ArrowUp'}),{document}),0);
  for(const init of [{altKey:true},{ctrlKey:true},{metaKey:true},{shiftKey:true}])assert.equal(navigationShortcut(key('plain',{key:'ArrowRight',...init}),{document}),0);
  for(const id of ['field','rich','handle','tool','inside'])assert.equal(navigationShortcut(key(id,{key:'ArrowRight'}),{document}),0,id);
  assert.equal(navigationShortcut(key('plain',{key:'ArrowRight'}),{document,draft:true}),0);
  const handled=key('plain',{key:'ArrowRight'});handled.preventDefault();assert.equal(navigationShortcut(handled,{document}),0);
  document.getElementById('dialog').setAttribute('open','');
  assert.equal(navigationShortcut(key('plain',{key:'ArrowRight'}),{document}),0,'An open dialog keeps the keyboard');
});

test('idle scheduling falls back to a timer and can be cancelled',async()=>{
  const seen=[];
  const cancel=scheduleIdle(()=>seen.push('cancelled'),{win:{}});cancel();
  let idle;scheduleIdle(()=>seen.push('idle'),{win:{requestIdleCallback:(callback,options)=>{assert.equal(options.timeout,1200);idle=callback;return 1;}}});
  idle();await new Promise(resolve=>setTimeout(resolve,250));
  assert.deepEqual(seen,['idle']);
});

function prefetchFixture({questions=['a','b','c'],current='b',exam=null,development=null,requestImpl}={}){
  const extension={id:'choice',version:'1.0.0'},requests=[],idle=[];
  const collection={questions:questions.map(id=>({id,type:extension})),states:{},features:{}};
  const pane={key:'bank:demo',kind:exam?'exam':'bank',id:'demo',collection,questionId:current,view:'practice',closed:false,...(exam?{exam}:{}),...(development?{development}:{})};
  const sandbox={questionsCache:createQuestionCache({schedule:null}),pagesCache:createQuestionCache({capacity:4,schedule:null}),
    questionCacheKey:(target,qid)=>`${target.key}:${qid}`,questionPath:(kind,id,qid)=>`/api/collections/${kind}/${id}/questions/${qid}`,
    request:async path=>{requests.push(path);if(requestImpl)return requestImpl(path);return path.endsWith('/page')?{html:path,style:'',script:''}:{question:{id:path.split('/').pop()},state:{status:'unanswered'},stamp:{packageVersion:'p1'},extension};},
    prepareAssets:async assets=>assets,scheduleIdle:callback=>{idle.push(callback);return ()=>{idle.splice(idle.indexOf(callback),1);};},
    active:()=>pane,visibleQuestions,navigationIndex,adjacentQuestionIds,questionExtension,collectionHasExtension,extensionPageRoute};
  vm.runInNewContext(`${part('function prefetchAdjacent(','\nasync function navigateQuestion(')}\nglobalThis.prefetchAdjacent=prefetchAdjacent;`,sandbox);
  return {pane,requests,idle,sandbox,run:async()=>{const callback=idle.shift();await callback?.();}};
}

test('idle prefetch warms the next and previous question payloads and their page',async()=>{
  const f=prefetchFixture();
  f.sandbox.prefetchAdjacent(f.pane);assert.equal(f.requests.length,0,'Nothing is read before the browser is idle');
  await f.run();
  assert.deepEqual(f.requests,['/api/collections/bank/demo/questions/c','/api/extensions/choice/1.0.0/page','/api/collections/bank/demo/questions/a']);
  assert.ok(f.sandbox.questionsCache.get('bank:demo:c'));assert.ok(f.sandbox.questionsCache.get('bank:demo:a'));
  f.sandbox.prefetchAdjacent(f.pane);await f.run();
  assert.equal(f.requests.length,3,'Cached neighbours and pages are not read again');
});

test('a newer switch cancels the pending prefetch and a moved card stops it',async()=>{
  const f=prefetchFixture();
  f.sandbox.prefetchAdjacent(f.pane);f.sandbox.prefetchAdjacent(f.pane);
  assert.equal(f.idle.length,1,'Only the latest card schedules a prefetch');
  f.pane.questionId='a';await f.run();
  assert.deepEqual(f.requests,[],'A prefetch for an old card reads nothing');
});

test('prefetch skips development previews and inactive views and ignores failures',async()=>{
  const dev=prefetchFixture({development:{folder:'demo'}});dev.sandbox.prefetchAdjacent(dev.pane);assert.equal(dev.idle.length,0);
  const summary=prefetchFixture();summary.pane.view='summary';summary.sandbox.prefetchAdjacent(summary.pane);assert.equal(summary.idle.length,0);
  const failing=prefetchFixture({requestImpl:async()=>{throw new Error('offline');}});
  failing.sandbox.prefetchAdjacent(failing.pane);await failing.run();
  assert.equal(failing.requests.length,2,'Each neighbour is tried once without surfacing an error');
});

test('exam prefetch reads the frozen exam page route',async()=>{
  const f=prefetchFixture({exam:{id:'exam1',status:'in-progress'},current:'a'});
  f.sandbox.prefetchAdjacent(f.pane);await f.run();
  assert.deepEqual(f.requests,['/api/collections/exam/demo/questions/b','/api/collections/exam/demo/questions/b/page']);
});

test('arrow keys and buttons share the merged stepper and reach the score summary',async t=>{
  const dom=new JSDOM(`<body><button id="previous"></button><button id="next"></button><button id="history-open"></button></body>`,{runScripts:'outside-only'});loadVueUi(dom);t.after(()=>dom.window.close());
  const document=dom.window.document,seen=[];let transition=Promise.resolve();
  const pane={view:'practice',questionId:'a',collection:{questions:[{id:'a'},{id:'b'},{id:'c'}]}};
  const sandbox={document,$:selector=>document.querySelector(selector),active:()=>pane,bindPracticeNavigation,navigateOutlineTarget(){},renderOutline(){},closeDrawers(){},draftViewActive:()=>false,
    transitionTo:fn=>{const run=transition.then(fn);transition=run.catch(()=>{});return run;},
    navigateQuestion:async(target,qid)=>{seen.push(qid);target.questionId=qid;},
    showScoreSummary:async target=>{seen.push('summary');target.summaryShown=true;target.view='summary';}};
  vm.runInNewContext(part('questionStepper=bindPracticeNavigation',"\n$('#history-open').addEventListener"),sandbox);
  t.after(()=>sandbox.questionStepper.destroy());
  for(let index=0;index<3;index++)document.body.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true}));
  await transition;
  assert.deepEqual(seen,['summary'],'Three quick presses jump straight to the summary');
  document.querySelector('#previous').click();await transition;
  assert.deepEqual(seen,['summary','c']);
  const blocked=new dom.window.KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true,cancelable:true,ctrlKey:true});document.body.dispatchEvent(blocked);await transition;
  assert.equal(blocked.defaultPrevented,false);assert.deepEqual(seen,['summary','c']);
});
