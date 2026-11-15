import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { loadVueUi } from '../fixtures/vue-ui.mjs';
import { renderLibraryView, destroyLibraryView } from '../../web/library/library-view.js';

test('V1 shared library keeps the original group DOM, hidden state and keyed rows', (t) => {
  const dom = new JSDOM(readFileSync(new URL('../../web/index.html', import.meta.url), 'utf8'), {
    runScripts: 'outside-only',
  });
  loadVueUi(dom);
  const document = dom.window.document;
  const opened = [];
  const options = {
    document,
    catalog: {
      canManage: false,
      developmentEnabled: false,
      banks: [{ id: 'a', title: 'Synthetic', group: 'Group' }],
      extensions: [],
      groups: { banks: ['Group'], extensions: [] },
    },
    listMode: 'bank',
    activeKey: 'bank:a',
    collapsedGroups: new Set(),
    onOpen: (...args) => opened.push(args),
    onNotice: () => {},
    onManage: () => {},
  };
  t.after(() => {
    destroyLibraryView(document);
    dom.window.close();
  });
  renderLibraryView(options);
  const body = document.querySelector('.extension-group-body');
  const row = body.querySelector('.library-item');
  assert.equal(body.tagName, 'DIV');
  assert.equal(body.hidden, false);
  assert.equal(body.hasAttribute('inert'), false);
  assert.equal(document.querySelector('.library-group-transition'), null);
  assert.equal(document.querySelector('.library-group-clip'), null);
  assert.equal(row.classList.contains('active'), true);
  document.querySelector('.extension-group-toggle').click();
  assert.equal(options.collapsedGroups.has('bank:Group'), true);
  assert.equal(body.hidden, true);
  assert.equal(document.querySelector('.extension-group-body'), body);
  assert.equal(document.querySelector('.library-item'), row);
  options.collapsedGroups.clear();
  renderLibraryView(options);
  assert.equal(body.hidden, false);
  row.click();
  assert.deepEqual(opened, [['bank', 'a']]);
});
