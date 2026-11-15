// Count expression casts, not variable types, typedefs, guards or satisfies.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

export function findAssertions(text, file = 'input.js') {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const result = [];
  function visit(node) {
    const type = ts.isParenthesizedExpression(node) && ts.getJSDocType(node);
    if (type) {
      result.push({
        line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
        type: type.getText(source),
        expression: node.expression.getText(source),
      });
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return result;
}

export function countAssertions() {
  const core = fileURLToPath(new URL('../../', import.meta.url));
  const file = path.join(core, 'tsconfig.server-v2.json');
  const config = ts.readConfigFile(file, ts.sys.readFile);
  if (config.error) {
    throw Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
  }
  const project = ts.parseJsonConfigFileContent(config.config, ts.sys, core);
  if (project.errors.length) {
    throw Error('Invalid server typecheck configuration');
  }
  const rows = project.fileNames
    .filter((name) => name.endsWith('.js'))
    .sort()
    .map((name) => ({
      file: path.relative(core, name).split(path.sep).join('/'),
      casts: findAssertions(fs.readFileSync(name, 'utf8'), name),
    }));
  return {
    modules: rows.length,
    total: rows.reduce((sum, row) => sum + row.casts.length, 0),
    rows,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  console.log(JSON.stringify(countAssertions(), null, 2));
}
