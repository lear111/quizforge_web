import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import ts from 'typescript';

const fixture = fileURLToPath(new URL('fixtures/shared-contracts.ts', import.meta.url));
const apiFile = fileURLToPath(new URL('../../shared/v2/api.d.ts', import.meta.url));
const options = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  strict: true,
  noEmit: true,
  skipLibCheck: false,
  types: [],
  lib: ['lib.es2022.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
};
function diagnostics(source) {
  const host = ts.createCompilerHost(options);
  const getSourceFile = host.getSourceFile.bind(host);
  let injected = false;
  host.getSourceFile = (name, languageVersion, ...rest) => {
    if (path.normalize(name) === path.normalize(fixture) && source !== undefined) {
      injected = true;
      return ts.createSourceFile(name, source, languageVersion, true);
    }
    return getSourceFile(name, languageVersion, ...rest);
  };
  const errors = ts.getPreEmitDiagnostics(ts.createProgram([fixture], options, host));
  assert.ok(source === undefined || injected, 'negative source must reach the real compiler');
  return errors;
}
const diagnosticText = (items) =>
  ts.formatDiagnosticsWithColorAndContext(items, {
    getCurrentDirectory: () => process.cwd(),
    getCanonicalFileName: (file) => file,
    getNewLine: () => '\n',
  });

test('shared contracts accept current requests, records and precise API return types', () => {
  const errors = diagnostics();
  assert.equal(errors.length, 0, diagnosticText(errors));
});

test('contracts reject missing request fields, opaque access and invalid host-owned data', () => {
  // Compile deliberately invalid assignments without suppressing diagnostics.
  const cases = [
    [
      'missing request ID',
      'const bad: AnswerRequest = { snapshotId:"s", expectedRevision:0, answer:null };',
    ],
    [
      'wrong ink version',
      'const bad: InkRequest = { requestId:"r", snapshotId:"s", expectedInkRevision:"0", ink:null };',
    ],
    ['wrong score', 'const bad: GradeResult = { score:"2", parts:null, message:null };'],
    ['wrong part score', 'const bad: GradeResult = { score:2, parts:{p:true}, message:null };'],
    [
      'unimplemented score comment',
      'const bad: GradeResult = { score:2, parts:null, message:"comment" };',
    ],
    ['wrong status', 'state.questions.q.status = "submitted-pending";'],
    ['misspelled error', 'const bad: ApiErrorCode = "SNAPSHOT_STATLE";'],
    ['opaque answer access', 'const bad = ({} as QuestionResponse).answer.choice;'],
    ['ink is not a question', 'const bad: QuestionResponse = {} as InkResponse;'],
    ['GET needs ink', 'const bad: QuestionReadResponse = {} as QuestionResponse;'],
    ['receipt signature', 'state.questions.q.receipts = [{ requestId:"r", signature:7 }];'],
    ['JSON cannot contain function', 'const bad: JsonValue = { callback: () => true };'],
    ['wrong maximum score', 'bank.outline[0].items[0].maxScore = "2";'],
    ['wrong part maximum', 'bank.outline[0].items[1].parts = [{ id:"p", maxScore:false }];'],
  ];
  const imports = fs.readFileSync(fixture, 'utf8');
  const source = imports + '\n' + cases.map(([, code]) => `{ ${code} }`).join('\n');
  const errors = diagnostics(source);
  const first = imports.split('\n').length;
  for (const [index, [name]] of cases.entries()) {
    assert.ok(
      errors.some(
        (item) =>
          item.file &&
          path.normalize(item.file.fileName) === path.normalize(fixture) &&
          item.file.getLineAndCharacterOfPosition(item.start).line === first + index,
      ),
      name + '\n' + diagnosticText(errors),
    );
  }
  assert.equal(errors.length, cases.length, diagnosticText(errors));
});

test('error-code union equals the codes emitted by the current V2 backend', () => {
  const source = ts.createSourceFile(
    apiFile,
    fs.readFileSync(apiFile, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  const declaration = source.statements.find(
    (node) => ts.isTypeAliasDeclaration(node) && node.name.text === 'ApiErrorCode',
  );
  const declared = declaration.type.types.map((node) => node.literal.text).sort();
  const actual = new Set();
  const literal = (node) => {
    if (ts.isStringLiteral(node)) {
      actual.add(node.text);
    } else if (ts.isConditionalExpression(node)) {
      literal(node.whenTrue);
      literal(node.whenFalse);
    }
  };
  function visit(node, tree) {
    if (ts.isCallExpression(node) && node.expression.getText(tree) === 'problem') {
      literal(node.arguments[0]);
    }
    if (
      ts.isPropertyAssignment(node) &&
      node.name.getText(tree) === 'code' &&
      ts.isStringLiteral(node.initializer)
    ) {
      literal(node.initializer); // publicError's non-V2Error fallback.
    }
    ts.forEachChild(node, (child) => visit(child, tree));
  }
  function scan(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        scan(file);
      } else if (entry.name.endsWith('.js')) {
        const tree = ts.createSourceFile(
          file,
          fs.readFileSync(file, 'utf8'),
          ts.ScriptTarget.Latest,
          true,
        );
        visit(tree, tree);
      }
    }
  }
  scan(fileURLToPath(new URL('../../server/v2', import.meta.url)));
  assert.deepEqual(declared, [...actual].sort());
});
