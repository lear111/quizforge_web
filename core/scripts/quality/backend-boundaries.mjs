import path from 'node:path';

const nextLayer = new Map([
  ['routes', 'controllers'],
  ['controllers', 'services'],
  ['services', 'repositories'],
  ['repositories', 'utils'],
]);
const layers = new Set([...nextLayer.keys(), 'utils', 'middleware']);

export function backendBoundaries(root) {
  const backend = path.join(root, 'core/server/v2');
  const platform = path.join(root, 'core/server/host/platform');
  const shared = path.join(root, 'core/shared/v2');
  const layerOf = (filename) => path.relative(backend, filename).split(path.sep)[0];
  const within = (directory, filename) => filename.startsWith(directory + path.sep);

  function allowed(from, to, target) {
    // Shared helpers are not business layers; app.js wires the stack together.
    if (within(platform, target) || within(shared, target)) {
      return ['middleware', 'services', 'repositories', 'utils'].includes(from);
    }
    return (
      layers.has(to) &&
      (from === 'app.js' ||
        to === from ||
        (from !== 'routes' && to === 'utils') ||
        to === nextLayer.get(from))
    );
  }

  return {
    meta: {
      type: 'problem',
      schema: [],
      messages: { direction: '{{from}} must not import {{source}}.' },
    },
    create(context) {
      const from = layerOf(context.filename);
      function check(source) {
        const value =
          source?.value ?? (source?.quasis?.length === 1 && source.quasis[0].value.cooked);
        if (typeof value !== 'string' || !value.startsWith('.')) {
          return;
        }
        const target = path.resolve(path.dirname(context.filename), value);
        if (!allowed(from, layerOf(target), target)) {
          context.report({ node: source, messageId: 'direction', data: { from, source: value } });
        }
      }

      return {
        ImportDeclaration: (node) => check(node.source),
        ExportNamedDeclaration: (node) => check(node.source),
        ExportAllDeclaration: (node) => check(node.source),
        ImportExpression: (node) => check(node.source),
      };
    },
  };
}
