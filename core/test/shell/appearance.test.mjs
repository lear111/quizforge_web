import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {THEMES,DEFAULT_DIM,DEFAULT_CLEAR,readAppearance,writeAppearance,applyAppearance,prepareImage,bindAppearanceSettings} from '../../web/shell/appearance.js';

const html=readFileSync(new URL('../../web/index.html',import.meta.url),'utf8');
const css=readFileSync(new URL('../../web/shell/themes.css',import.meta.url),'utf8');
function memoryStorage(initial={}){const values=new Map(Object.entries(initial));return {getItem:key=>values.has(key)?values.get(key):null,setItem:(key,value)=>values.set(key,String(value)),values};}
function fixture(t,{saved,images=null}={}){
  const dom=new JSDOM(html,{url:'http://localhost/'});t.after(()=>dom.window.close());
  const document=dom.window.document,storage=memoryStorage(saved?{'quizforge-appearance':JSON.stringify(saved)}:{});
  let next=0;const urls=new Set();
  const URL={createObjectURL:()=>{const url=`blob:test/${++next}`;urls.add(url);return url;},revokeObjectURL:url=>urls.delete(url)};
  const view=bindAppearanceSettings({document,storage,images,URL});t.after(()=>view.destroy());
  const get=id=>document.getElementById(id);
  return {dom,document,storage,view,get,urls,root:document.documentElement,saved:()=>JSON.parse(storage.values.get('quizforge-appearance')||'null')};
}

test('saved appearance is validated and falls back to the default look',()=>{
  assert.deepEqual(readAppearance(memoryStorage()),{theme:'default',dim:DEFAULT_DIM,clear:{...DEFAULT_CLEAR},custom:false});
  for(const raw of ['not json','{"theme":"neon","dim":33}','{"theme":"paper","dim":95}','{"theme":"image","dim":-5,"custom":"yes"}']){
    const value=readAppearance(memoryStorage({'quizforge-appearance':raw}));
    assert.ok(THEMES.some(item=>item.id===value.theme));assert.ok(value.dim>=0&&value.dim<=80&&value.dim%5===0);assert.equal(typeof value.custom,'boolean');
  }
  assert.deepEqual(readAppearance(memoryStorage({'quizforge-appearance':'{"theme":"green","dim":45,"custom":true}'})),{theme:'green',dim:45,clear:{...DEFAULT_CLEAR},custom:true});
  assert.equal(readAppearance({getItem(){throw new Error('blocked');}}).theme,'default','Blocked storage keeps the default look');
  assert.doesNotThrow(()=>writeAppearance({setItem(){throw new Error('quota');}},{theme:'paper',dim:30,custom:false}));
});

test('applying a theme sets only the root attribute and variables; default removes them',t=>{
  const dom=new JSDOM('<!doctype html><html><body></body></html>');t.after(()=>dom.window.close());
  const root=dom.window.document.documentElement;
  applyAppearance(root,{theme:'image',dim:45,custom:true},'blob:test/1');
  assert.equal(root.dataset.qfTheme,'image');assert.equal(root.style.getPropertyValue('--qf-dim'),'0.45');assert.equal(root.style.getPropertyValue('--qf-image'),'url("blob:test/1")');
  applyAppearance(root,{theme:'default',dim:30,custom:false});
  assert.equal(root.hasAttribute('data-qf-theme'),false);assert.equal(root.style.getPropertyValue('--qf-image'),'');
});

test('every theme in the list has styles and a swatch, and the default picture is the fallback',()=>{
  for(const {id} of THEMES){
    assert.match(css,new RegExp(`data-swatch="${id}"`),`swatch for ${id}`);
    if(id!=='default')assert.match(css,new RegExp(`html\\[data-qf-theme="${id}"\\]\\{`),`variables for ${id}`);
  }
  assert.match(css,/var\(--qf-image,url\("\/assets\/backgrounds\/dawn-lake\.svg"\)\)/);
  assert.match(css,/\.question-pane:not\(\.is-draft\) \.question-viewport\{background:var\(--qf-around\)\}/,'Draft mode keeps the whiteboard paper');
  const general=css.indexOf('.question-pane:not(.is-draft) .question-viewport{background:var(--qf-around)}'),phone=css.lastIndexOf('.question-pane:not(.is-draft) .question-viewport{background:#fff}');
  assert.ok(phone>general,'The phone rule must come after the general rule to win at equal specificity');
  assert.doesNotMatch(css,/:is\(\.question-navigation/,'The full-pane navigation layer is never painted outside the phone bar');
});

test('the appearance tab shows its panel, hides the other panels and saves a chosen theme',t=>{
  const f=fixture(t);
  const tab=f.get('settings-appearance-tab'),panel=f.get('appearance-settings-panel');
  assert.equal(f.root.hasAttribute('data-qf-theme'),false);assert.equal(panel.hidden,true);
  const buttons=[...f.document.querySelectorAll('.appearance-theme')];
  assert.deepEqual(buttons.map(button=>button.textContent),THEMES.map(item=>item.label));
  tab.click();
  assert.equal(panel.hidden,false);
  for(const id of ['network-settings-form','ai-settings-panel','development-settings-panel'])assert.equal(f.get(id).hidden,true,id);
  assert.equal(tab.getAttribute('aria-selected'),'true');assert.equal(f.get('settings-network-tab').getAttribute('aria-selected'),'false');
  f.document.querySelector('.appearance-theme[data-theme="sepia"]').click();
  assert.equal(f.root.dataset.qfTheme,'sepia');assert.deepEqual(f.saved(),{theme:'sepia',dim:30,clear:{...DEFAULT_CLEAR},custom:false});
  assert.equal(f.get('appearance-image').hidden,true,'Image options only show for the image theme');
  f.get('settings-ai-tab').click();
  assert.equal(panel.hidden,true);assert.equal(tab.getAttribute('aria-selected'),'false');
  tab.click();f.get('network-settings-dialog').dispatchEvent(new f.dom.window.Event('close'));
  assert.equal(panel.hidden,true,'Closing settings hides the appearance panel');
});

test('arrow keys move the theme selection and the mask slider updates live',t=>{
  const f=fixture(t,{saved:{theme:'image',dim:30,custom:false}});
  assert.equal(f.root.dataset.qfTheme,'image');
  const list=f.get('appearance-themes'),key=k=>list.dispatchEvent(new f.dom.window.KeyboardEvent('keydown',{key:k,bubbles:true,cancelable:true}));
  key('ArrowRight');assert.equal(f.root.hasAttribute('data-qf-theme'),false,'Selection wraps from the last theme to the default look');assert.equal(f.saved().theme,'default');
  key('ArrowLeft');key('ArrowLeft');assert.equal(f.root.dataset.qfTheme,'green');
  assert.equal(f.document.querySelector('.appearance-theme[data-theme="green"]').tabIndex,0);
  f.document.querySelector('.appearance-theme[data-theme="image"]').click();
  assert.equal(f.get('appearance-image').hidden,false);
  const dim=f.get('appearance-dim');dim.value='55';dim.dispatchEvent(new f.dom.window.Event('input'));
  assert.equal(f.root.style.getPropertyValue('--qf-dim'),'0.55');assert.equal(f.get('appearance-dim-value').textContent,'55%');assert.equal(f.saved().dim,55);
  assert.equal(f.get('appearance-image-choose').disabled,true,'Without a browser image store the picker is disabled');
});

test('a saved custom picture is restored, and a missing one falls back to the default picture',async t=>{
  const blob=new Blob(['x'],{type:'image/jpeg'});
  const restored=fixture(t,{saved:{theme:'image',dim:30,custom:true},images:{get:async()=>blob,put:async()=>{},remove:async()=>{}}});
  await restored.view.ready;
  assert.match(restored.root.style.getPropertyValue('--qf-image'),/^url\("blob:test\/\d+"\)$/);
  const missing=fixture(t,{saved:{theme:'image',dim:30,custom:true},images:{get:async()=>undefined,put:async()=>{},remove:async()=>{}}});
  await missing.view.ready;
  assert.equal(missing.root.style.getPropertyValue('--qf-image'),'');assert.equal(missing.saved().custom,false);
  const removed=[];const reset=fixture(t,{saved:{theme:'image',dim:30,custom:true},images:{get:async()=>blob,put:async()=>{},remove:async()=>{removed.push(true);}}});
  await reset.view.ready;reset.get('appearance-image-reset').click();await new Promise(resolve=>setTimeout(resolve,0));
  assert.deepEqual(removed,[true]);assert.equal(reset.root.style.getPropertyValue('--qf-image'),'');assert.equal(reset.saved().custom,false);assert.equal(reset.urls.size,0,'The old object URL is revoked');
});

test('chosen pictures are checked, scaled to 2560px and re-encoded as JPEG',async()=>{
  await assert.rejects(prepareImage({type:'text/plain',size:10}),/请选择图片文件/);
  await assert.rejects(prepareImage({type:'image/png',size:31*1024*1024}),/30 MB/);
  await assert.rejects(prepareImage({type:'image/heic',size:10},{decode:async()=>{throw new Error('unsupported');}}),/无法读取/);
  let drawn=null,closed=false,encoded=null;
  const canvas={getContext:()=>({fillRect(){},drawImage:(_image,x,y,width,height)=>{drawn={width,height};}}),toBlob:(callback,type,quality)=>{encoded={type,quality};callback(new Blob(['jpeg'],{type}));}};
  const document={createElement:name=>{assert.equal(name,'canvas');return canvas;}};
  const result=await prepareImage({type:'image/png',size:6*1024*1024},{document,decode:async()=>({width:6400,height:4000,close(){closed=true;}})});
  assert.deepEqual(drawn,{width:2560,height:1600});assert.equal(canvas.width,2560);assert.equal(canvas.height,1600);
  assert.equal(encoded.type,'image/jpeg');assert.equal(result.type,'image/jpeg');assert.equal(closed,true);
  await prepareImage({type:'image/jpeg',size:1000},{document,decode:async()=>({width:800,height:600,close(){}})});
  assert.deepEqual(drawn,{width:800,height:600},'Small pictures keep their size');
});

test('panel transparency is kept per theme, validated, and hidden for the default look',t=>{
  assert.deepEqual(Object.keys(DEFAULT_CLEAR).sort(),THEMES.map(item=>item.id).filter(id=>id!=='default').sort(),'Every non-default theme has a transparency');
  const saved=readAppearance(memoryStorage({'quizforge-appearance':JSON.stringify({theme:'mist',clear:{mist:55,image:75,paper:12,green:'20',neon:30}})}));
  assert.deepEqual(saved.clear,{...DEFAULT_CLEAR,mist:55},'Out-of-range, off-step, non-number and unknown values fall back');
  const f=fixture(t,{saved:{theme:'mist',dim:30,custom:false}});
  const panels=f.get('appearance-panels'),clear=f.get('appearance-clear'),set=value=>{clear.value=String(value);clear.dispatchEvent(new f.dom.window.Event('input'));};
  assert.equal(panels.hidden,false);assert.equal(clear.value,String(DEFAULT_CLEAR.mist));assert.equal(f.root.style.getPropertyValue('--qf-clear'),String(DEFAULT_CLEAR.mist/100));
  set(60);
  assert.equal(f.root.style.getPropertyValue('--qf-clear'),'0.6');assert.equal(f.get('appearance-clear-value').textContent,'60%');assert.equal(f.saved().clear.mist,60);
  f.document.querySelector('.appearance-theme[data-theme="image"]').click();
  assert.equal(clear.value,String(DEFAULT_CLEAR.image),'Each theme keeps its own value');assert.equal(f.root.style.getPropertyValue('--qf-clear'),String(DEFAULT_CLEAR.image/100));
  f.document.querySelector('.appearance-theme[data-theme="mist"]').click();
  assert.equal(clear.value,'60');
  f.document.querySelector('.appearance-theme[data-theme="default"]').click();
  assert.equal(panels.hidden,true);assert.equal(f.root.style.getPropertyValue('--qf-clear'),'','The default look has no transparency');
});

test('themes give panel colours and one rule mixes in the transparency',()=>{
  assert.doesNotMatch(css,/--qf-(panel|bar):(rgba|#)/,'Themes set colours, not fixed transparencies');
  for(const {id} of THEMES)if(id!=='default'){
    const block=css.slice(css.indexOf(`html[data-qf-theme="${id}"]{`)).split('}')[0];
    assert.match(block,/--qf-panel-color:/,id);assert.match(block,/--qf-bar-color:/,id);
  }
  assert.match(css,/--qf-panel:color-mix\(in srgb,var\(--qf-panel-color\) calc\(100% - var\(--qf-clear,0\) \* 100%\),transparent\)/);
  assert.match(css,/@media\(max-width:800px\)\{\s*html\[data-qf-theme\] \.library,html\[data-qf-theme\] \.outline\{background:var\(--qf-panel-solid\)\}/,'Narrow-screen drawers stay solid');
});
