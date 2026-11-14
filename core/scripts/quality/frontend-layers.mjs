import path from 'node:path';

const allowed = {
  views: ['views', 'components', 'router', 'stores', 'types', 'styles'],
  components: ['components', 'router', 'stores', 'types', 'styles'],
  router: ['router', 'stores', 'types'],
  stores: ['stores', 'api', 'services', 'types'],
  api: ['api', 'services', 'types'],
  services: ['services', 'api', 'types'],
  types: ['types', 'api', 'services'],
};
function layer(file) {
  const normalized = file.replaceAll('\\', '/');
  if (normalized.endsWith('/frontend/src/v2/App.vue')) {
    return 'views';
  }
  return normalized.match(/\/frontend\/src\/v2\/([^/]+)(?:\/|$)/)?.[1];
}

function invalidDirection(from, filename, resolved) {
  const target = layer(resolved);
  const normalized = resolved.replaceAll('\\', '/');
  const composition = /\/frontend\/src\/v2\/(main(?:\.ts)?|App\.vue)$/.test(normalized);
  const routeWiring =
    filename.replaceAll('\\', '/').endsWith('/v2/router/index.ts') && target === 'views';
  const reverse = target && !allowed[from].includes(target) && !routeWiring;
  const lowerVue =
    ['api', 'services', 'types', 'stores'].includes(from) && normalized.endsWith('.vue');
  return composition || reverse || lowerVue;
}

export const frontendLayers = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      direction: 'V2 前端层间依赖方向不允许：{{from}} → {{target}}。',
      fetch: 'V2 网络请求只能在 api/ 中使用 fetch。',
    },
  },
  create(context) {
    const from = layer(context.filename);
    function inspect(node, source) {
      if (!allowed[from] || typeof source !== 'string' || !source.startsWith('.')) {
        return;
      }
      const resolved = path.resolve(path.dirname(context.filename), source);
      const target = layer(resolved);
      if (invalidDirection(from, context.filename, resolved)) {
        context.report({ node, messageId: 'direction', data: { from, target: target ?? source } });
      }
    }
    return {
      ImportDeclaration: (node) => inspect(node, node.source.value),
      ExportNamedDeclaration: (node) => inspect(node, node.source?.value),
      ExportAllDeclaration: (node) => inspect(node, node.source.value),
      ImportExpression: (node) => inspect(node, node.source.value),
      CallExpression(node) {
        if (node.callee.type === 'Identifier' && node.callee.name === 'require') {
          inspect(node, node.arguments[0]?.value);
        }
      },
      Identifier(node) {
        if (from === 'api' || node.name !== 'fetch') {
          return;
        }
        const parent = node.parent;
        if (
          parent.type === 'Property' &&
          parent.key === node &&
          !parent.shorthand &&
          parent.parent.type !== 'ObjectPattern'
        ) {
          return;
        }
        context.report({ node, messageId: 'fetch' });
      },
      MemberExpression(node) {
        if (from !== 'api' && node.computed && node.property.value === 'fetch') {
          context.report({ node, messageId: 'fetch' });
        }
      },
    };
  },
};
