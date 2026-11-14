import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import ts from 'typescript';

const core = fileURLToPath(new URL('../../', import.meta.url));
const configFile = path.join(core, 'tsconfig.server-v2.json');
const config = ts.readConfigFile(configFile, ts.sys.readFile);
assert.equal(config.error, undefined);
const project = ts.parseJsonConfigFileContent(config.config, ts.sys, core, {}, configFile);
assert.deepEqual(project.errors, []);
const fixture = path.join(core, 'test/v2/fixtures/server-types.mjs');
const formatErrors = (errors) =>
  ts.formatDiagnosticsWithColorAndContext(errors, {
    getCurrentDirectory: () => core,
    getCanonicalFileName: (name) => name,
    getNewLine: () => '\n',
  });
function program(source) {
  const host = ts.createCompilerHost(project.options);
  host.getCurrentDirectory = () => core;
  const read = host.getSourceFile.bind(host);
  let injected = false;
  host.getSourceFile = (name, version, ...rest) => {
    if (source !== undefined && path.normalize(name) === path.normalize(fixture)) {
      injected = true;
      return ts.createSourceFile(name, source, version, true, ts.ScriptKind.JS);
    }
    return read(name, version, ...rest);
  };
  const result = ts.createProgram([...project.fileNames, fixture], project.options, host);
  assert.ok(source === undefined || injected, 'negative probes must reach the compiler');
  return result;
}

test('server project strictly checks real JS in all three layers without shadow declarations', () => {
  assert.equal(project.options.allowJs, true);
  assert.equal(project.options.checkJs, true);
  assert.equal(project.options.strict, true);
  assert.equal(project.options.noEmit, true);
  assert.equal(project.options.skipLibCheck, false);
  const compiled = program();
  for (const layer of ['controllers', 'services', 'repositories']) {
    const directory = path.join(core, 'server/v2', layer);
    for (const name of fs.readdirSync(directory).filter((entry) => entry.endsWith('.js'))) {
      const file = path.join(directory, name);
      const source = compiled.getSourceFile(file);
      assert.ok(source && !source.isDeclarationFile, file);
      assert.ok(source.checkJsDirective?.enabled !== false, file);
      assert.ok(!fs.existsSync(file.replace(/\.js$/, '.d.ts')), file);
      assert.doesNotMatch(source.text, /@ts-(?:ignore|expect-error|nocheck)/);
    }
  }
  const errors = ts.getPreEmitDiagnostics(compiled);
  assert.equal(errors.length, 0, formatErrors(errors));
});

test('actual JS guards and outputs reject invalid field use in strict mode', () => {
  const probes = [
    [
      'unknown input',
      18046,
      '/** @param {unknown} value */ function bad(value) { return value.answer; }',
    ],
    [
      'question guard',
      2322,
      '/** @param {unknown} value */ function bad(value) { if (validQuestion(value)) value.revision = "1"; }',
    ],
    [
      'result guard',
      2322,
      '/** @param {unknown} value */ function bad(value) { if (validResultShape(value)) value.parts = {p:false}; }',
    ],
    [
      'opaque solution',
      2571,
      '/** @param {LibrarySnapshots} lib */ function bad(lib) { return lib.question("b","q","s").solution.key; }',
    ],
    [
      'unknown HTTP input',
      18046,
      '/** @param {HttpResponse} res */ function bad(res) { return res.locals.input.answer; }',
    ],
    [
      'maximum scores',
      2345,
      '/** @param {Snapshot} snapshot */ function bad(snapshot) { snapshot.maxScores.set("q", "3"); }',
    ],
    [
      'record assertion',
      2322,
      '/** @param {unknown} value */ function bad(value) { validateState(value); if (!own(value,"historyIndex")) value.questions.q.revision = "1"; }',
    ],
    ['error code', 2345, 'problem("SNAPSHOT_STATLE", "message");'],
    [
      'HTTP response',
      2345,
      '/** @param {ServerContext} server */ function bad(server) { server.immutable("response"); }',
    ],
    [
      'SDK wildcard',
      2339,
      '/** @type {SdkHandler} */ const bad = (req) => { return req.params.entry.toUpperCase(); };',
    ],
    [
      'precise write union',
      2339,
      '/** @param {LibrarySnapshots} lib */ function bad(lib) { return lib.write("b","q","ink", null).question; }',
    ],
  ];
  const positive = fs.readFileSync(fixture, 'utf8');
  let content = positive + '\n';
  const ranges = probes.map(([name, expectedCode, body]) => {
    const start = content.split('\n').length - 1;
    // A JSDoc tag needs its own line to attach to the following JS declaration.
    content += '{\n' + body.replace(/\*\/ (function|const)/g, '*/\n$1') + '\n}\n';
    return { name, expectedCode, start, end: content.split('\n').length - 1 };
  });
  const errors = ts.getPreEmitDiagnostics(program(content));
  for (const range of ranges) {
    const ownErrors = errors.filter((error) => {
      if (!error.file || path.normalize(error.file.fileName) !== path.normalize(fixture)) {
        return false;
      }
      const line = error.file.getLineAndCharacterOfPosition(error.start).line;
      return line >= range.start && line < range.end;
    });
    assert.deepEqual(
      ownErrors.map((error) => error.code),
      [range.expectedCode],
      range.name + '\n' + formatErrors(errors),
    );
  }
  assert.equal(errors.length, probes.length, formatErrors(errors));
});
