// Only the tracked public showcase. Not a general bank/state upgrader.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export const repo = fileURLToPath(new URL('../../../', import.meta.url));
export function basicDemo() {
  const source = path.join(repo, 'question-banks/基础题型/基础题型展示');
  const old = JSON.parse(fs.readFileSync(path.join(source, 'bank.json'), 'utf8'));
  const groups = new Map([
    ['单选题', { type: 'quizforge.single-choice@2', field: 'correctOptionId', output: 'selected' }],
    [
      '多选题',
      { type: 'quizforge.multiple-choice@2', field: 'correctOptionIds', output: 'selected' },
    ],
    ['判断题', { type: 'quizforge.true-false@2', field: 'correctAnswer', output: 'value' }],
  ]);
  const assets = new Set();
  const adapt = (value) => {
    if (Array.isArray(value)) {
      return value.map(adapt);
    }
    if (!value || typeof value !== 'object') {
      return value;
    }
    const copy = Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, adapt(child)]),
    );
    if (copy.type === 'image' && copy.attrs?.assetId) {
      const relative = 'assets/' + copy.attrs.assetId + '.png';
      assets.add(relative);
      copy.attrs.src = 'qf-asset:' + relative;
      delete copy.attrs.assetId;
    }
    return copy;
  };
  const outline = [],
    questions = {};
  for (const [title, spec] of groups) {
    const items = [];
    for (const q of old.questions.filter(
      (q) => q.extension.path === 'extensions/基础题型/' + title,
    )) {
      const d = q.data;
      items.push({ id: q.id, label: q.outline.label, maxScore: d.maxScore });
      questions[q.id] = {
        type: spec.type,
        question: { stem: adapt(d.stem), ...(d.options ? { options: adapt(d.options) } : {}) },
        solution: { [spec.output]: d[spec.field], explanation: adapt(d.answerAndExplanation) },
      };
    }
    outline.push({ title, items });
  }
  return {
    source,
    assets: [...assets],
    bank: {
      formatVersion: 2,
      id: old.id,
      title: old.title,
      description:
        '原基础题型展示库：单选、多选、判断。保留原编号、富文本与素材；简答和答题区留待后续迁移。',
      features: { history: true, exam: true },
      outline,
      questions,
    },
  };
}
export function stageBasicDemo() {
  const { source, assets, bank } = basicDemo(),
    directory = path.join(repo, 'examples/v2/question-banks/基础题型/基础题型展示');
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'bank.json'), JSON.stringify(bank, null, 2) + '\n');
  for (const relative of assets) {
    const file = path.join(directory, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.copyFileSync(path.join(source, relative), file);
  }
  console.log(
    `已生成公开示例：${Object.keys(bank.questions).length} 题，${assets.length} 个素材；不读取或迁移作答记录。`,
  );
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  stageBasicDemo();
}
