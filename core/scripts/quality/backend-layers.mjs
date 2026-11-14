import path from 'node:path';

const allowed = {
  routes: ['routes', 'controllers', 'utils'],
  middleware: ['middleware', 'utils'],
  controllers: ['controllers', 'services', 'utils'],
  services: ['services', 'repositories', 'utils'],
  repositories: ['repositories', 'utils'],
  utils: ['utils'],
};
const layer = (file) => file.replaceAll('\\', '/').match(/\/server\/v2\/([^/]+)\//)?.[1];

export const backendLayers = {
  meta: {
    type: 'problem',
    schema: [],
    messages: { direction: 'V2 层间依赖方向不允许：{{from}} → {{target}}。' },
  },
  create(context) {
    const from = layer(context.filename);
    if (!allowed[from]) {
      // app.js is the composition root: it wires all layers together.
      return {};
    }
    function inspect(node, source) {
      if (typeof source !== 'string') {
        return;
      }
      const resolved = path.resolve(path.dirname(context.filename), source);
      const target = layer(resolved);
      const normalized = resolved.replaceAll('\\', '/');
      const diskAccess =
        /^(node:)?fs(?:\/promises)?$/.test(source) ||
        /\/host\/platform\/(files|file-cache)\.js$/.test(normalized);
      // Declaration-only data dependencies do not reverse runtime layer calls.
      const sharedType =
        target === 'types' && (node.importKind === 'type' || node.exportKind === 'type');
      const reversed = target && !allowed[from].includes(target) && !sharedType;
      const compositionRoot = normalized.endsWith('/server/v2/app.js');
      if (
        reversed ||
        compositionRoot ||
        (diskAccess && !['repositories', 'utils'].includes(from))
      ) {
        context.report({ node, messageId: 'direction', data: { from, target: target ?? source } });
      }
    }
    return {
      ImportDeclaration: (node) => inspect(node, node.source.value),
      ExportNamedDeclaration: (node) => inspect(node, node.source?.value),
      ExportAllDeclaration: (node) => inspect(node, node.source.value),
      ImportExpression: (node) => inspect(node, node.source.value),
      CallExpression: (node) => {
        if (node.callee.type === 'Identifier' && node.callee.name === 'require') {
          inspect(node, node.arguments[0]?.value);
        }
      },
    };
  },
};
