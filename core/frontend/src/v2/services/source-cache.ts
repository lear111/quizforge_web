interface Manifest {
  name: string;
  sdkVersions?: Record<string, string>;
}
interface Loaders {
  json(route: string, signal: AbortSignal): Promise<Manifest>;
  text(route: string, signal: AbortSignal): Promise<string>;
}
export function createPageSourceCache(loaders: Loaders) {
  let key = '',
    snapshot = '',
    epoch = 0,
    abort = new AbortController();
  const pages = new Map<
      string,
      Promise<{ name: string; html: string; js: string; css: string; sdks: string[] }>
    >(),
    sdks = new Map<string, Promise<{ js: string; css: string }>>();
  const invalid = () => new Error('题型文件加载已失效，请重新打开本题。');
  function clear() {
    epoch++;
    abort.abort();
    abort = new AbortController();
    pages.clear();
    sdks.clear();
  }
  return {
    scope(bankId: string, snapshotId: string, authorization: string) {
      const next = JSON.stringify([bankId, snapshotId, authorization]);
      if (next !== key) {
        clear();
        key = next;
        snapshot = snapshotId;
      }
    },
    load(artifactId: string) {
      const cached = pages.get(artifactId);
      if (cached) {
        return cached;
      }
      const mine = epoch,
        signal = abort.signal,
        snapshotId = snapshot,
        root = `/api/v2/extensions/${encodeURIComponent(artifactId)}`;
      const promise = (async () => {
        const manifest = await loaders.json(root + '/manifest', signal);
        if (mine !== epoch) {
          throw invalid();
        }
        const sdkSources = Object.entries(manifest.sdkVersions ?? {})
          .filter(([id]) => id === 'richtext')
          .map(([id, version]) => {
            const sdk = `${id}@${version}`;
            if (!sdks.has(sdk)) {
              const sdkRoot = `/api/v2/sdk/${id}/${encodeURIComponent(version)}/richtext`;
              const suffix = `?snapshotId=${encodeURIComponent(snapshotId)}`;
              const pending = Promise.all([
                loaders.text(sdkRoot + '.js' + suffix, signal),
                loaders.text(sdkRoot + '.css' + suffix, signal),
              ])
                .then(([js, css]) => ({ js, css }))
                .catch((error) => {
                  if (sdks.get(sdk) === pending) {
                    sdks.delete(sdk);
                  }
                  throw error;
                });
              sdks.set(sdk, pending);
            }
            return sdks.get(sdk)!;
          });
        const [html, js, css, sources] = await Promise.all([
          loaders.text(root + '/files/practice-html', signal),
          loaders.text(root + '/files/practice-js', signal),
          loaders.text(root + '/files/practice-css', signal),
          Promise.all(sdkSources),
        ]);
        if (mine !== epoch) {
          throw invalid();
        }
        return {
          name: manifest.name,
          html,
          js,
          css: [...sources.map((source) => source.css), css].join('\n'),
          sdks: sources.map((source) => source.js),
        };
      })();
      pages.set(artifactId, promise);
      void promise.catch(() => {
        if (pages.get(artifactId) === promise) {
          pages.delete(artifactId);
        }
      });
      return promise;
    },
    dispose() {
      clear();
      key = '';
    },
  };
}
