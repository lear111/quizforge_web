import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {loadVueUi} from '../fixtures/vue-ui.mjs';
import {renderOutlineView} from '../../web/outline/outline-view.js';

test('empty library renders and reuses an empty outline without an active pane',t=>{
  const dom=new JSDOM('<div id="outline-list"><span>stale</span></div>',{runScripts:'outside-only'});
  loadVueUi(dom);t.after(()=>dom.window.close());
  const document=dom.window.document,root=document.getElementById('outline-list');
  const render=()=>renderOutlineView({document,pane:undefined,onNavigate(){assert.fail('no navigation');},onSummary(){assert.fail('no summary');}});
  assert.doesNotThrow(render);
  assert.equal(root.children.length,0);
  let replacements=0;const replace=root.replaceChildren.bind(root);
  root.replaceChildren=(...nodes)=>{replacements++;return replace(...nodes);};
  assert.doesNotThrow(render);
  assert.equal(replacements,0);
});
