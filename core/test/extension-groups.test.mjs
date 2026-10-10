import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {JSDOM} from 'jsdom';
import {extensionGroups} from '../web/extension-groups.js';

const source=readFileSync(new URL('../web/app.js',import.meta.url),'utf8'),renderSource=source.slice(source.indexOf('function renderLibrary('),source.indexOf('\nfunction renderOutline('));

test('physical groups build nested folders while preserving independent leaves and input data',()=>{
  const rows=[{id:'root'},{id:'choice',group:'基础题型'},{id:'essay',group:'基础题型/语言'},{id:'essay-dev',group:'基础题型/语言'},{id:'logic',group:'其他\\逻辑'}],before=structuredClone(rows);
  const groups=extensionGroups(rows);
  assert.equal(groups[0].row,rows[0]);assert.equal(groups[1].name,'基础题型');assert.equal(groups[1].children[0].row.id,'choice');assert.equal(groups[1].children[1].path,'基础题型/语言');assert.deepEqual(groups[1].children[1].children.map(leaf=>leaf.row.id),['essay','essay-dev']);assert.equal(groups[2].children[0].path,'其他/逻辑');assert.deepEqual(rows,before);
});

function fixture(t){
  const dom=new JSDOM(readFileSync(new URL('../web/index.html',import.meta.url),'utf8'));t.after(()=>dom.window.close());const document=dom.window.document,opened=[],notices=[];
  const catalog={developmentEnabled:true,banks:[{id:'mixed',title:'混合练习',questionCount:2,group:'不会成为题库分组'}],extensions:[{id:'standalone',name:'独立题型',questionCount:1},{id:'choice',name:'单选',version:'1.0.0',group:'基础题型',questionCount:1},{id:'essay',name:'简答',version:'1.3.0',group:'基础题型/语言',questionCount:2},{id:'essay-dev',name:'简答开发',group:'基础题型/语言',kind:'development',questionCount:1,development:{mode:'ui'}}]};
  const sandbox={document,$:selector=>document.querySelector(selector),listMode:'extension',activeKey:'extension:essay',catalog,extensionGroups,collapsedExtensionGroups:new Set(),notice:message=>notices.push(message),transitionTo:fn=>fn(),openCollection:(...args)=>opened.push(args),el:(tag,classes,text)=>{const node=document.createElement(tag);node.className=classes||'';if(text!=null)node.textContent=text;return node;}};
  vm.runInNewContext(renderSource+'\nglobalThis.render=renderLibrary;',sandbox);sandbox.render();return {dom,document,opened,notices,sandbox,catalog};
}

test('group toggles only visibility and each formal or development leaf opens its own sample',t=>{
  const f=fixture(t),groups=[...f.document.querySelectorAll('.extension-group-toggle')];
  assert.deepEqual(groups.map(button=>button.dataset.extensionGroup),['基础题型','基础题型/语言']);assert.equal(f.document.querySelectorAll('.library-item').length,4);assert.equal(f.document.querySelectorAll('#library-list .development-badge').length,1);assert.equal(f.document.querySelector('.library-item.active').dataset.itemId,'essay');
  groups[0].click();assert.equal(groups[0].getAttribute('aria-expanded'),'false');assert.equal(f.document.getElementById(groups[0].getAttribute('aria-controls')).hidden,true);assert.deepEqual(f.opened,[]);
  groups[0].click();assert.equal(groups[0].getAttribute('aria-expanded'),'true');assert.equal(f.document.getElementById(groups[0].getAttribute('aria-controls')).hidden,false);
  for(const id of ['standalone','choice','essay','essay-dev'])f.document.querySelector(`[data-item-id="${id}"]`).click();
  assert.deepEqual(f.opened,[['extension','standalone'],['extension','choice'],['extension','essay'],['development','essay-dev']]);
});

test('collapse survives catalog rerenders and list switching without changing mixed-bank or extension identities',t=>{
  const f=fixture(t),getGroup=path=>[...f.document.querySelectorAll('.extension-group-toggle')].find(button=>button.dataset.extensionGroup===path);
  getGroup('基础题型/语言').click();f.sandbox.render();assert.equal(getGroup('基础题型/语言').getAttribute('aria-expanded'),'false');
  f.sandbox.listMode='bank';f.sandbox.render();assert.equal(f.document.querySelectorAll('.extension-group-toggle').length,0);f.document.querySelector('[data-item-id="mixed"]').click();assert.deepEqual(f.opened,[['bank','mixed']]);
  f.sandbox.listMode='extension';f.sandbox.render();assert.equal(getGroup('基础题型/语言').getAttribute('aria-expanded'),'false');
  f.catalog.extensions.find(row=>row.id==='essay').group='移动后的分组';f.sandbox.render();const essay=f.document.querySelector('[data-item-id="essay"]');assert.equal(essay.classList.contains('active'),true);essay.click();assert.deepEqual(f.opened.at(-1),['extension','essay']);
});

test('folder names remain plain text and errors stay attached to independent extension leaves',t=>{
  const f=fixture(t);f.catalog.extensions=[{id:'bad',name:'尚未完成',group:'<img src=x>/开发',kind:'development',error:'页面缺失'}];f.sandbox.render();
  assert.equal(f.document.querySelector('#library-list img'),null);assert.equal(f.document.querySelector('.extension-group-label').textContent,'<img src=x>');f.document.querySelector('[data-item-id="bad"]').click();assert.deepEqual(f.notices,['页面缺失']);assert.deepEqual(f.opened,[]);
});
