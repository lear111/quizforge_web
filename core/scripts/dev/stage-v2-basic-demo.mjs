// Only the tracked public showcase. Not a general bank/state upgrader.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export const repo = fileURLToPath(new URL('../../../', import.meta.url));
const escape = (text) =>
  String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
// Deliberately handles only the nodes in the seven tracked public examples.
function html(value, assets) {
  if (value.type === 'text') {
    let text = escape(value.text).replaceAll('$', '\\$');
    for (const mark of value.marks ?? []) {
      if (mark.type !== 'bold') {
        throw new Error('Unexpected public example mark: ' + mark.type);
      }
      text = '<strong>' + text + '</strong>';
    }
    return text;
  }
  if (value.type === 'inlineMath' || value.type === 'blockMath') {
    const delimiter = value.type === 'blockMath' ? '$$' : '$';
    return delimiter + escape(value.attrs.latex) + delimiter;
  }
  if (value.type === 'image') {
    const relative = 'assets/' + value.attrs.assetId + '.png';
    assets.add(relative);
    return (
      `<img src="qf-asset:${relative}" alt="${escape(value.attrs.alt ?? '')}"` +
      (value.attrs.width ? ` width="${value.attrs.width}"` : '') +
      '>'
    );
  }
  const tags = {
    doc: '',
    paragraph: 'p',
    table: 'table',
    tableRow: 'tr',
    tableHeader: 'th',
    tableCell: 'td',
  };
  const tag = tags[value.type];
  if (tag === undefined) {
    throw new Error('Unexpected public example node: ' + value.type);
  }
  const children = (value.content ?? []).map((child) => html(child, assets)).join('');
  const attributes = ['colspan', 'rowspan']
    .filter((key) => value.attrs?.[key])
    .map((key) => ` ${key}="${value.attrs[key]}"`)
    .join('');
  return tag ? `<${tag}${attributes}>${children}</${tag}>` : children;
}

const groups = new Map([
  ['单选题', { type: 'quizforge.single-choice@3', field: 'correctOptionId', output: 'selected' }],
  [
    '多选题',
    { type: 'quizforge.multiple-choice@3', field: 'correctOptionIds', output: 'selected' },
  ],
  ['判断题', { type: 'quizforge.true-false@3', field: 'correctAnswer', output: 'value' }],
]);

export function basicDemo() {
  const source = path.join(repo, 'question-banks/基础题型/基础题型展示');
  const old = JSON.parse(fs.readFileSync(path.join(source, 'bank.json'), 'utf8'));
  const assets = new Set();
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
        question: {
          stem: html(d.stem, assets),
          ...(d.options
            ? {
                options: d.options.map((option) => ({
                  ...option,
                  content: html(option.content, assets),
                })),
              }
            : {}),
        },
        solution: {
          [spec.output]: d[spec.field],
          explanation: html(d.answerAndExplanation, assets),
        },
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
