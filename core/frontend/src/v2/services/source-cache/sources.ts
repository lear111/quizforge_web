import type { CacheState, Loaders, Manifest, PageSources, Scope } from './types';

function sdkSources(state: CacheState, loaders: Loaders, manifest: Manifest, scope: Scope) {
  return Object.entries(manifest.sdkVersions ?? {})
    .filter(([id]) => id === 'richtext')
    .map(([id, version]) => {
      const sdk = `${id}@${version}`;
      if (!state.sdks.has(sdk)) {
        const pending = loaders.sdk
          .richtext(version, scope.snapshotId, scope.signal)
          .catch((error) => {
            if (state.sdks.get(sdk) === pending) {
              state.sdks.delete(sdk);
            }
            throw error;
          });
        state.sdks.set(sdk, pending);
      }
      return state.sdks.get(sdk)!;
    });
}

export async function loadSources(
  state: CacheState,
  loaders: Loaders,
  artifactId: string,
  scope: Scope,
): Promise<PageSources> {
  const invalid = () => new Error('题型文件加载已失效，请重新打开本题。');
  const manifest = await loaders.extensions.manifest(artifactId, scope.signal);
  if (scope.epoch !== state.epoch) {
    throw invalid();
  }
  // Keep SDK requests before HTML/JS/CSS, then await the same parallel group.
  const pendingSdks = sdkSources(state, loaders, manifest, scope);
  const [html, js, css, sources] = await Promise.all([
    loaders.extensions.file(artifactId, 'practice-html', scope.signal),
    loaders.extensions.file(artifactId, 'practice-js', scope.signal),
    loaders.extensions.file(artifactId, 'practice-css', scope.signal),
    Promise.all(pendingSdks),
  ]);
  if (scope.epoch !== state.epoch) {
    throw invalid();
  }
  return {
    name: manifest.name,
    html,
    js,
    css: [...sources.map((source) => source.css), css].join('\n'),
    sdks: sources.map((source) => source.js),
  };
}
