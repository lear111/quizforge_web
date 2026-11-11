// Exact contentIdentities body from approved main 725a550, retained as oracle.
import fs from 'node:fs';import path from 'node:path';
import {declaration} from '../../server/host/extensions/extension-packages.js';
import {readListening} from '../../server/host/resources/listening.js';
import {walkFiles,exists,readJson,safeFile} from '../../server/host/platform/files.js';
import {fingerprint} from '../../server/host/platform/json.js';
export function baselineContentIdentities(scope, folders = new Map(), previousSource = null) {
    const values = []; let sourceOffset;
    for (const directory of [...scope.folders].sort()) {
      let inputs = folders.get(directory);
      if (!inputs) {
        const config = declaration(directory);
        inputs = [directory, config];
        for (const file of walkFiles(directory).sort()) {
          if (!fs.lstatSync(file).isFile()) continue;
          inputs.push(path.relative(directory, file), this.files.hash(file));
        }
        folders.set(directory, inputs);
      }
      // Share scans within this index response only. Every later read checks again.
      for (const input of inputs) values.push(input);
    }
    if (scope.source) {
      sourceOffset = values.length;
      values.push(scope.source, this.files.hash(scope.source));
      const listening = readListening(this.files.json(scope.source));
      for (const file of new Set(listening?.materials.map(row => row.file) ?? [])) values.push(file, this.files.hash(safeFile(path.dirname(scope.source), file), 8 * 1024 * 1024));
      const assets = path.join(path.dirname(scope.source), 'assets');
      if (path.basename(scope.source) === 'bank.json' && path.dirname(scope.source) !== path.join(this.root, 'question-banks') && exists(assets)) for (const file of walkFiles(assets).sort()) if (fs.lstatSync(file).isFile()) values.push(path.relative(path.dirname(scope.source), file), this.files.hash(file, 4 * 1024 * 1024));
    }
    const registry = path.join(this.codeRoot, 'shared', 'richtext', 'service.json');
    if (exists(registry)) values.push(readJson(registry, 64 * 1024));
    const current = fingerprint(values, 'quizforge-node-library-source-v1');
    if (!previousSource || sourceOffset === undefined) return { current };
    values[sourceOffset] = previousSource.path; values[sourceOffset + 1] = previousSource.hash;
    return { current, previous: fingerprint(values, 'quizforge-node-library-source-v1') };
  }
