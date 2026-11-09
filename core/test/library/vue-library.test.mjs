import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {loadVueUi} from '../fixtures/vue-ui.mjs';
import {renderLibraryView,destroyLibraryView} from '../../web/library/library-view.js';

function fixture(t){
  const dom=new JSDOM(readFileSync(new URL('../../web/index.html',import.meta.url),'utf8'),{runScripts:'outside-only'});
  loadVueUi(dom);const document=dom.window.document,opened=[],managed=[],notices=[];
  const options={document,catalog:{canManage:true,developmentEnabled:true,banks:[],extensions:[],groups:{banks:[],extensions:[]}},listMode:'bank',activeKey:null,collapsedGroups:new Set(),onOpen:(...args)=>opened.push(args),onManage:(...args)=>managed.push(args),onNotice:value=>notices.push(value)};
  t.after(()=>{destroyLibraryView(document);dom.window.close();});
  return {document,options,opened,managed,notices,render:()=>renderLibraryView(options)};
}

test('catalog refresh patches keyed controls, preserves focus, and replaces callbacks exactly once',t=>{
  const f=fixture(t);f.options.catalog.banks=[{id:'a',title:'练习 1'}];f.render();
  const button=f.document.querySelector('[data-item-id="a"]');button.focus();
  const fresh=[];f.options.onOpen=(...args)=>fresh.push(args);f.options.catalog.banks=[{id:'a',title:'改名后的练习'},{id:'b',title:'练习 2'}];
  f.options.activeKey='bank:a';f.render();f.render();
  assert.equal(f.document.querySelector('[data-item-id="a"]'),button);assert.equal(f.document.activeElement,button);
  assert.match(button.textContent,/改名后的练习/);assert.equal(button.classList.contains('active'),true);
  button.click();assert.deepEqual(fresh,[['bank','a']]);assert.deepEqual(f.opened,[]);
});

test('mixed documents and banks share groups and retain independent identities and plain-text titles',t=>{
  const f=fixture(t);f.options.catalog.banks=[{id:'same',title:'练习 10',group:'资料'}];
  f.options.catalog.documents=[{id:'same',kind:'document',format:'pdf',title:'练习 2 <img src=x>',size:2048,group:'资料'},{id:'word',kind:'document',format:'docx',title:'笔记',size:1024*1024}];f.render();
  assert.equal(f.document.querySelectorAll('.extension-group').length,1);assert.equal(f.document.querySelectorAll('#library-list img').length,0);
  const group=f.document.querySelector('.extension-group-body');assert.match(group.querySelector('.item-name').textContent,/练习 2/);
  assert.equal(f.document.querySelectorAll('.document-file-icon').length,2);
  f.document.querySelector('.document-file-icon.pdf').closest('button').click();assert.deepEqual(f.opened,[['document','same']]);
  f.document.querySelector('.document-file-icon.pdf').closest('.library-row').querySelector('[data-library-action]').click();assert.equal(f.managed[0][1],f.options.catalog.documents[0]);
});

test('permissions and errors survive refresh; unmount allows a fresh list without stale handlers',t=>{
  const f=fixture(t);f.options.catalog.banks=[{id:'bad',title:'坏题库',error:{message:'结构错误'}}];f.render();
  f.document.querySelector('.library-item').click();assert.deepEqual(f.notices,['结构错误']);assert.deepEqual(f.opened,[]);
  f.options.catalog.canManage=false;f.render();assert.equal(f.document.querySelector('[data-library-action]'),null);assert.equal(f.document.querySelector('#library-import').hidden,true);
  destroyLibraryView(f.document);assert.equal(f.document.querySelector('#library-list').children.length,0);
  f.options.catalog.banks=[];f.render();assert.match(f.document.querySelector('.list-empty').textContent,/主机上导入/);
  f.options.catalog.banks=[{id:'new',title:'新题库'}];f.render();f.document.querySelector('.library-item').click();assert.deepEqual(f.opened,[['bank','new']]);
});
