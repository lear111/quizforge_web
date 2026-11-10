import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {createCollectionLoading} from '../../web/practice/collection-loading.js';
import {loadVueUi} from '../fixtures/vue-ui.mjs';

test('a stale loading completion cannot dismiss a later operation',t=>{
  const dom=new JSDOM(readFileSync(new URL('../../web/index.html',import.meta.url),'utf8'),{runScripts:'outside-only'});loadVueUi(dom);t.after(()=>dom.window.close());
  const loading=createCollectionLoading(dom.window.document),node=dom.window.document.querySelector('#collection-loading');
  assert.equal(node.hidden,true);const first=loading.begin('First'),second=loading.begin('<script>');
  first.setDetail('Old status');first.finish();assert.equal(node.hidden,false);assert.equal(node.querySelector('.collection-loading-title').textContent,'<script>');assert.equal(node.querySelector('script'),null);
  second.setDetail('正在加载首题…');assert.match(node.textContent,/正在加载首题/);second.finish();assert.equal(node.hidden,true);
});
