import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {historyProgress} from '../web/history-view.js';

const source=readFileSync(new URL('../web/app.js',import.meta.url),'utf8');
const start=source.indexOf('const historyPath=');
const end=source.indexOf('async function showHistory(',start);
assert.ok(start>=0&&end>start,'The production history-list controller must be present');
const historySource=source.slice(start,end);
const elementSource=source.split(/\r?\n/).find(line=>line.startsWith('const el='));
const summaryDisposalSource=source.split(/\r?\n/).find(line=>line.startsWith('function disposeScoreSummary('));
const dialogBindings=source.split(/\r?\n/).filter(line=>/^\$\('#history-(?:close|dialog|delete-(?:cancel|confirm|dialog))'\)\.addEventListener/.test(line));
assert.equal(dialogBindings.length,6,'The production list and confirmation dialog handlers must be present');

// Run the actual list controller against a small DOM and request transport. The
// fixture supplies no deletion logic: confirmation, locks, recovery and rendering
// are all exercised through the same click handlers used by the browser.
function fixture({requestImpl=async()=>({}),returnError=null,records=2,view='practice'}={}){
  const nodes=new Map(),requests=[],confirmations=[],opened=[],transitions=[],events=[],loads=[],status=[];
  const document={activeElement:null,querySelector:selector=>nodes.get(selector),createElement:tag=>new Element(tag)};
  class Element{
    constructor(tag){this.tagName=tag;this.children=[];this.listeners=new Map();this.attributes={};this.disabled=false;this.hidden=false;this.className='';this.dataset={};this.parent=null;this.textContent='';this.closed=false;}
    append(...children){for(const child of children){child.parent=this;this.children.push(child);}}
    replaceChildren(...children){if(this.contains(document.activeElement))document.activeElement=null;for(const child of this.children)child.parent=null;this.children=[];this.append(...children);}
    contains(node){return node===this||this.children.some(child=>child.contains(node));}
    setAttribute(name,value){this.attributes[name]=value;}
    addEventListener(name,callback){const callbacks=this.listeners.get(name)||[];callbacks.push(callback);this.listeners.set(name,callbacks);}
    dispatch(name,event={}){event.target??=this;event.defaultPrevented=false;event.preventDefault=()=>{event.defaultPrevented=true;};for(const callback of this.listeners.get(name)||[]){const value=callback(event);if(value?.then){events.push(value);value.catch(()=>{});}}return event;}
    click(){if(!this.disabled)this.dispatch('click');}
    querySelectorAll(selector){const matches=node=>selector.split(',').some(part=>{part=part.trim();return part.startsWith('.')?node.className.split(' ').includes(part.slice(1)):node.tagName===part;});const found=[];const visit=node=>{for(const child of node.children){if(matches(child))found.push(child);visit(child);}};visit(this);return found;}
    querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
    focus(){if(!this.disabled)document.activeElement=this;}
    close(){this.closed=true;this.shown=false;this.dispatch('close');}
    showModal(){this.closed=false;this.shown=true;if(this===nodes.get('#history-delete-dialog'))confirmations.push(nodes.get('#history-delete-detail').textContent);}
  }
  for(const [id,tag]of [['history-dialog','dialog'],['history-list','div'],['history-title','h2'],['history-error','p'],['history-close','button'],['history-delete-dialog','dialog'],['history-delete-detail','p'],['history-delete-cancel','button'],['history-delete-confirm','button']])nodes.set(`#${id}`,new Element(tag));
  nodes.get('#history-dialog').append(nodes.get('#history-close'),nodes.get('#history-list'));
  nodes.get('#history-delete-dialog').append(nodes.get('#history-delete-detail'),nodes.get('#history-delete-cancel'),nodes.get('#history-delete-confirm'));
  const pane={kind:'bank',id:'bank',view,questionId:'q1',collection:{title:'测试题库'},historyRecords:Array.from({length:records},(_,index)=>({id:`round-${index+1}`,collectionTitle:'测试题库',createdAt:`2026-10-07T0${index+1}:00:00Z`,updatedAt:`2026-10-07T0${index+1}:01:00Z`,status:'completed',submittedCount:2,questionCount:2,score:2,maxScore:2})),frameHost:new Element('div'),whiteboard:{load:value=>loads.push(value)}};
  if(view==='history'){pane.historyEntry={id:'round-1'};pane.historyView={frozen:true};pane.historyQuestion={frozen:true};pane.historyQuestionId='q1';pane.plugin={destroy(){pane.pluginDestroyed=true;}};}
  const sandbox={document,Date,Promise,encodeURIComponent,historyProgress,
    $:selector=>document.querySelector(selector),collectionPath:()=>'/api/collections/bank/bank',
    request:async(path,options)=>{requests.push({path,options});return requestImpl(path,options);},
    transitionTo:fn=>{const operation=Promise.resolve().then(fn);transitions.push(operation);operation.catch(()=>{});return operation;},
    showHistory:async(_pane,id)=>opened.push(id),flushPane:async()=>{},
    returnToPractice:async()=>{if(returnError)throw returnError;pane.view='practice';},
    renderOutline(){},updateChrome(){},saveStatus:value=>status.push(value),
  };
  pane.node={classList:{remove(){}}};
  vm.runInNewContext(`${elementSource}\n${summaryDisposalSource}\n${historySource}\n${dialogBindings.join('\n')}\nglobalThis.controller={renderHistoryList,openHistoryList};`,sandbox);
  sandbox.controller.renderHistoryList(pane);
  const list=nodes.get('#history-list');
  return {pane,nodes,requests,confirmations,opened,loads,status,document,
    row:index=>list.children[index].querySelector('.history-row'),
    remove:index=>list.children[index].querySelector('.history-delete'),
    delete(index,accepted=true){list.children[index].querySelector('.history-delete').click();nodes.get(accepted?'#history-delete-confirm':'#history-delete-cancel').click();},
    async settled(){for(let index=0;index<events.length;index++)await events[index];for(let index=0;index<transitions.length;index++)await transitions[index].catch(()=>{});},
    reopen:()=>sandbox.controller.openHistoryList(pane)};
}
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('canceling delete leaves the record intact and does not open it',async()=>{
  const f=fixture();f.delete(0,false);await f.settled();
  assert.equal(f.confirmations.length,1);assert.equal(f.requests.length,0);assert.equal(f.pane.historyRecords.length,2);assert.equal(f.opened.length,0);assert.equal(f.nodes.get('#history-list').children.length,2);
});

test('confirmation locks the list before awaiting a decision and ignores duplicate clicks',async()=>{
  const f=fixture(),remove=f.remove(0),open=f.row(1);remove.click();
  assert.equal(f.nodes.get('#history-delete-dialog').shown,true);assert.equal(f.nodes.get('#history-list').attributes['aria-busy'],'true');assert.equal(remove.disabled,true);assert.equal(open.disabled,true);assert.equal(f.nodes.get('#history-close').disabled,true);
  assert.equal(f.nodes.get('#history-delete-cancel').disabled,false);assert.equal(f.nodes.get('#history-delete-confirm').disabled,false);
  remove.dispatch('click');open.dispatch('click');await tick();
  assert.equal(f.confirmations.length,1);assert.equal(f.requests.length,0);assert.equal(f.opened.length,0);
  f.nodes.get('#history-delete-cancel').click();await f.settled();assert.equal(f.pane.historyRecords.length,2);assert.equal(remove.disabled,false);assert.equal(f.nodes.get('#history-delete-dialog').shown,false);
});

test('Escape cancels the confirmation and does not dismiss or modify the history list',async()=>{
  const f=fixture();f.remove(0).click();
  assert.equal(f.nodes.get('#history-delete-dialog').dispatch('cancel').defaultPrevented,true);await f.settled();
  assert.equal(f.nodes.get('#history-delete-dialog').shown,false);assert.equal(f.nodes.get('#history-dialog').closed,false);assert.equal(f.pane.historyRecords.length,2);assert.equal(f.requests.length,0);assert.equal(f.nodes.get('#history-list').attributes['aria-busy'],'false');
});

test('closing confirmation without accepting also cancels the pending decision',async()=>{
  const f=fixture();f.remove(0).click();f.nodes.get('#history-delete-dialog').close();await f.settled();
  assert.equal(f.pane.historyRecords.length,2);assert.equal(f.requests.length,0);assert.equal(f.remove(0).disabled,false);
});

test('open and delete are separate controls; deletion refreshes the row and restores focus',async()=>{
  const f=fixture();assert.equal(f.row(0).parent,f.remove(0).parent);assert.notEqual(f.row(0),f.remove(0));
  f.remove(0).focus();f.delete(0);await f.settled();
  assert.equal(f.opened.length,0);assert.equal(f.nodes.get('#history-dialog').closed,false);
  assert.equal(f.requests.length,1);assert.equal(f.requests[0].options.method,'DELETE');assert.equal(f.requests[0].path,'/api/collections/bank/bank/history/round-1');
  assert.deepEqual(f.pane.historyRecords.map(row=>row.id),['round-2']);assert.equal(f.nodes.get('#history-list').children.length,1);
  assert.equal(f.document.activeElement,f.row(0));assert.equal(f.document.activeElement.disabled,false);
  f.row(0).click();await f.settled();assert.deepEqual(f.opened,['round-2']);assert.equal(f.nodes.get('#history-dialog').closed,true);
});

test('pending deletion blocks duplicate requests, opening records and Escape dismissal',async()=>{
  const pending=deferred(),f=fixture({requestImpl:()=>pending.promise}),remove=f.remove(0),open=f.row(1);
  remove.click();assert.equal(f.nodes.get('#history-delete-dialog').shown,true);assert.equal(f.requests.length,0);
  f.nodes.get('#history-delete-confirm').click();await tick();assert.equal(f.requests.length,1);
  assert.equal(f.nodes.get('#history-list').attributes['aria-busy'],'true');assert.equal(f.nodes.get('#history-close').disabled,true);
  remove.dispatch('click');open.dispatch('click');assert.equal(f.confirmations.length,1);assert.equal(f.opened.length,0);assert.equal(f.requests.length,1);
  assert.equal(f.nodes.get('#history-dialog').dispatch('cancel').defaultPrevented,true);
  pending.resolve({});await f.settled();
  assert.equal(f.nodes.get('#history-list').attributes['aria-busy'],'false');assert.equal(f.nodes.get('#history-close').disabled,false);
  assert.equal(f.nodes.get('#history-dialog').dispatch('cancel').defaultPrevented,false);
});

test('a failed server write preserves the row and current frozen view for retry',async()=>{
  const failure=new Error('写入失败'),f=fixture({view:'history',requestImpl:async()=>{throw failure;}});
  const before=f.pane.historyEntry;f.delete(0);await f.settled();
  assert.equal(f.pane.historyRecords.length,2);assert.equal(f.nodes.get('#history-list').children.length,2);assert.equal(f.pane.historyEntry,before);assert.equal(f.pane.pluginDestroyed,undefined);
  assert.match(f.nodes.get('#history-error').textContent,/删除失败：写入失败/);assert.equal(f.nodes.get('#history-error').hidden,false);assert.equal(f.remove(0).disabled,false);
});

test('deleting the displayed record clears its snapshot and returns to current practice',async()=>{
  const f=fixture({view:'history'});f.delete(0);await f.settled();
  assert.equal(f.pane.view,'practice');assert.equal(f.pane.pluginDestroyed,true);assert.equal(f.pane.plugin,null);
  for(const key of ['historyEntry','historyView','historyQuestion','historyQuestionId'])assert.equal(f.pane[key],null);
  assert.deepEqual(f.loads,[null]);assert.deepEqual(f.status,['记录已删除']);assert.equal(f.pane.historyRecords.length,1);
});

test('a failed return after deletion cannot keep the deleted snapshot alive',async()=>{
  const f=fixture({view:'history',returnError:new Error('题库已移除')});f.delete(0);await f.settled();
  assert.equal(f.pane.view,'history-deleted');assert.equal(f.pane.historyEntry,null);assert.equal(f.pane.historyView,null);assert.equal(f.pane.plugin,null);
  assert.match(f.pane.frameHost.children[0].textContent,/此历史记录已删除/);assert.match(f.nodes.get('#history-error').textContent,/记录已删除，但返回作答失败：题库已移除/);assert.equal(f.pane.historyRecords.length,1);
});

test('already-deleted response removes a stale row and focuses close for an empty list',async()=>{
  const error=Object.assign(new Error('已不存在'),{status:404}),f=fixture({records:1,requestImpl:async()=>{throw error;}});
  f.delete(0);await f.settled();
  assert.equal(f.pane.historyRecords.length,0);assert.equal(f.nodes.get('#history-error').hidden,true);assert.equal(f.document.activeElement,f.nodes.get('#history-close'));assert.equal(f.document.activeElement.disabled,false);
  assert.match(f.nodes.get('#history-list').children[0].textContent,/还没有历史记录/);
});

test('a lost delete response retains local data until a fresh list verifies the result',async()=>{
  const timeout=Object.assign(new Error('等待超时'),{code:'REQUEST_TIMEOUT'}),f=fixture({requestImpl:async(_path,options)=>{if(options?.method==='DELETE')throw timeout;return {records:[]};}});
  f.delete(0);await f.settled();
  assert.equal(f.pane.historyRecords.length,2);assert.match(f.nodes.get('#history-error').textContent,/重新打开历史列表确认是否已删除/);
  await f.reopen();assert.equal(f.pane.historyRecords.length,0);assert.equal(f.nodes.get('#history-error').hidden,true);assert.equal(f.requests.length,2);
});

test('a fresh list clears the displayed snapshot when a timed-out deletion actually succeeded',async()=>{
  const timeout=Object.assign(new Error('等待超时'),{code:'REQUEST_TIMEOUT'}),f=fixture({view:'history',requestImpl:async(_path,options)=>{if(options?.method==='DELETE')throw timeout;return {records:[]};}});
  f.delete(0);await f.settled();assert.equal(f.pane.view,'history');assert.notEqual(f.pane.historyEntry,null);
  await f.reopen();assert.equal(f.pane.view,'practice');assert.equal(f.pane.historyEntry,null);assert.equal(f.pane.historyView,null);assert.equal(f.pane.pluginDestroyed,true);assert.equal(f.pane.historyRecords.length,0);
  assert.equal(f.nodes.get('#history-dialog').shown,true);assert.equal(f.nodes.get('#history-close').disabled,false);
});

test('fresh-list recovery preserves its error when the current bank cannot be loaded',async()=>{
  const f=fixture({view:'history',returnError:new Error('题库已移除'),requestImpl:async()=>({records:[]})});
  await f.reopen();assert.equal(f.pane.view,'history-deleted');assert.equal(f.pane.historyEntry,null);assert.equal(f.pane.historyView,null);
  assert.match(f.nodes.get('#history-error').textContent,/记录已删除，但返回作答失败：题库已移除/);assert.equal(f.nodes.get('#history-error').hidden,false);assert.equal(f.nodes.get('#history-dialog').shown,true);assert.equal(f.nodes.get('#history-close').disabled,false);
});
