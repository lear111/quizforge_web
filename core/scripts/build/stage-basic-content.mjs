import fs from 'node:fs';
import path from 'node:path';

export const BASIC_EXTENSIONS = ['单选题', '多选题', '判断题', '简答题', '简答题（答题区）', '听力理解'];
const group = '基础题型';
export function stageBasicContent(root, target, filter = () => true) {
  const copy = (source, destination) => fs.cpSync(path.join(root, source), path.join(target, destination), { recursive: true, filter: file => !['.instance.json', '.bundle.json'].includes(path.basename(file)) && filter(file) });
  for (const name of BASIC_EXTENSIONS) {
    const destination = 'extensions/' + group + '/' + name;
    copy(destination, destination);
  }
  copy('extensions/README.md', 'extensions/README.md');
  const metadata = 'question-banks/' + group + '/.group.json';
  if (fs.existsSync(path.join(root, metadata))) copy(metadata, metadata);
  const bank = 'question-banks/' + group + '/基础题型展示'; copy(bank, bank);
  fs.writeFileSync(path.join(target, 'extensions', group, '.bundle.json'), JSON.stringify({ schemaVersion: 1, kind: 'extension-bundle' }));
  return { extensions: BASIC_EXTENSIONS.map(name => group + '/' + name), banks: [group + '/基础题型展示'] };
}
