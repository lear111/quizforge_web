// Regression probes retain their original synthetic questions independently
// of the public demo. Never copy .qf-v2 or an author's practice records.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const repo = fileURLToPath(new URL('../../../', import.meta.url));
export function copyBrowserFixture(root) {
  fs.cpSync(path.join(repo, 'examples/v2/extensions'), path.join(root, 'extensions'), { recursive: true });
  const directory = path.join(root, 'question-banks/基础题型/单选题展示');
  fs.mkdirSync(directory, { recursive: true });
  fs.copyFileSync(fileURLToPath(new URL('./v2-browser-bank.json', import.meta.url)), path.join(directory, 'bank.json'));
}
