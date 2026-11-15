import fs from 'node:fs';
import path from 'node:path';
import { copyBrowserFixture } from '../../test/fixtures/v2-browser.mjs';

function partsExtension(extension, manifest) {
  fs.writeFileSync(
    path.join(extension, 'manifest.json'),
    JSON.stringify({ ...manifest, id: 'synthetic.parts', name: '合成小题' }),
  );
  fs.writeFileSync(
    path.join(extension, 'practice.css'),
    'body{margin:0;font:16px sans-serif}label{display:block;margin:18px}button{margin:12px}',
  );
  fs.writeFileSync(
    path.join(extension, 'practice.html'),
    '<label><input id="a" type="checkbox">小题甲</label><label><input id="b" type="checkbox">小题乙</label><button id="submit">提交答案</button><button id="retry">重做</button><strong id="result"></strong>',
  );
  fs.writeFileSync(
    path.join(extension, 'practice.js'),
    `QF.page.register({load(c){for(const id of ['a','b']){const n=document.getElementById(id);n.checked=c.answer?.[id]===true;n.disabled=c.locked;n.onchange=()=>QF.page.changed({kind:'choice',answered:{[id]:n.checked,foreign:true}});}for(const name of ['submit','retry']){const b=document.getElementById(name);b.hidden=!c.can[name];b.onclick=()=>QF.page[name]().catch(()=>{});}document.getElementById('result').textContent=typeof c.result?.score==='number'?c.result.score+' 分':'';},getAnswer(){return {a:document.getElementById('a').checked,b:document.getElementById('b').checked};}});`,
  );
  fs.writeFileSync(
    path.join(extension, 'grade.js'),
    `QF.grader.register({grade(q,s,a,item){return {score:1,parts:{a:0,b:1}};}});`,
  );
}

export function contractFixture(root) {
  copyBrowserFixture(root);
  const originalDirectory = path.join(root, 'question-banks/基础题型/单选题展示');
  const bank = JSON.parse(fs.readFileSync(path.join(originalDirectory, 'bank.json'), 'utf8'));
  const extension = path.join(root, 'extensions/基础题型/parts');
  fs.mkdirSync(extension);
  const manifest = JSON.parse(
    fs.readFileSync(path.join(root, 'extensions/基础题型/单选题/manifest.json'), 'utf8'),
  );
  partsExtension(extension, manifest);
  bank.outline = [
    {
      title: '合成分组',
      items: [
        { id: '1', label: '1', maxScore: 2 },
        {
          id: '2',
          parts: [
            { id: 'a', label: '2甲', maxScore: 1 },
            { id: 'b', label: '2乙', maxScore: 1 },
          ],
        },
      ],
    },
  ];
  bank.questions = {
    1: bank.questions['1'],
    2: {
      type: 'synthetic.parts@2',
      question: {},
      solution: { unique: 'SOLUTION_PRIVATE_UNTIL_LOCK' },
    },
  };
  for (const name of ['desktop', 'mobile']) {
    const dir = path.join(root, 'question-banks/基础题型', name);
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'bank.json'), JSON.stringify({ ...bank, title: name }));
  }
  fs.rmSync(originalDirectory, { recursive: true }); // Only the temp copy.
}
