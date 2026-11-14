// Build an in-memory copy of the UI for the loopback benchmark. Exact anchors
// fail closed when the corresponding production boundary moves.
import path from 'node:path';
import { build } from 'vite';

function replaceOnce(source, before, after) {
  if (source.split(before).length !== 2) {
    throw new Error('Probe anchor changed: ' + before);
  }
  return source.replace(before, () => after);
}

export async function buildPhaseUi(core) {
  const results = await build({
    root: core,
    configFile: path.join(core, 'frontend/vite.config.ts'),
    logLevel: 'error',
    build: { write: false },
    plugins: [
      {
        name: 'quizforge-bank-return-probe',
        enforce: 'pre',
        transform(code, id) {
          const file = id.replaceAll('\\', '/');
          const stamp =
            'const phase = (name: string) => (globalThis as any).__qfBankReturnPhases?.push([name, performance.timeOrigin + performance.now()]);';
          if (file.endsWith('/v2/App.vue')) {
            const declaration = 'async function openBank(_kind: string, id?: string)';
            const overview = 'const value: Overview = await json(`${requestPrefix(id)}/overview`);';
            code = replaceOnce(code, declaration, stamp + '\n' + declaration);
            return replaceOnce(
              code,
              overview,
              "phase('overview:start');" + overview + "phase('overview:end');",
            );
          }
          if (file.endsWith('/v2/views/use-practice-page.ts')) {
            const declaration = 'async function show(q: Question, resume = true)';
            const sources =
              'const [loaded, assets] = await Promise.all([sources.load(q.extension.artifactId), pictures(q)]);';
            code = replaceOnce(code, declaration, stamp + '\n' + declaration);
            code = replaceOnce(
              code,
              sources,
              "phase('sources:start');" + sources + "phase('sources:end');",
            );
            return replaceOnce(
              code,
              'await instance.ready;',
              "await instance.ready;phase('host:ready');",
            );
          }
          if (id.replaceAll('\\', '/').endsWith('/v2/services/page.ts')) {
            code = replaceOnce(
              code,
              'const frame = document.createElement',
              "(globalThis as any).__qfBankReturnPhases?.push(['frame:start', performance.timeOrigin + performance.now()]);\n  const frame = document.createElement",
            );
            code = replaceOnce(
              code,
              'const runtime = `(()=>{',
              "const runtime = `(()=>{\n    const phase=(name)=>parent.postMessage({qfBankReturnPhase:name,at:performance.timeOrigin+performance.now()},'*');phase('frame:runtime');",
            );
            code = replaceOnce(
              code,
              'for(const source of ${literal([...sources.sdks, sources.js])}){',
              "let scriptIndex=0;for(const source of ${literal([...sources.sdks, sources.js])}){\n        const phaseName=scriptIndex++ < ${sources.sdks.length} ? 'sdk' : 'type-script';phase(phaseName+':start');",
            );
            code = replaceOnce(
              code,
              'finally{script.remove();URL.revokeObjectURL(url);}',
              "finally{script.remove();URL.revokeObjectURL(url);phase(phaseName+':end');}",
            );
            code = replaceOnce(
              code,
              'await page.load(context);reportHeight();',
              "phase('load:start');await page.load(context);phase('load:end');reportHeight();requestAnimationFrame(()=>requestAnimationFrame(()=>phase('frame:paint')));",
            );
            return code;
          }
        },
      },
    ],
  });
  const bundle = (Array.isArray(results) ? results : [results])
    .flatMap((result) => result.output)
    .find((item) => item.type === 'chunk' && item.isEntry);
  if (!bundle) {
    throw new Error('Probe UI bundle missing');
  }
  return Buffer.from(bundle.code);
}
