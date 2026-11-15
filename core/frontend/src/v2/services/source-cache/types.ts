import type { PracticeApi } from '../../api';
export type Loaders = Pick<PracticeApi, 'extensions' | 'sdk'>;
export type Manifest = Awaited<ReturnType<Loaders['extensions']['manifest']>>;
export type SdkSources = Awaited<ReturnType<Loaders['sdk']['richtext']>>;
export interface PageSources {
  name: string;
  html: string;
  js: string;
  css: string;
  sdks: string[];
}
export interface Scope {
  epoch: number;
  signal: AbortSignal;
  snapshotId: string;
}
export interface CacheState {
  key: string;
  snapshot: string;
  epoch: number;
  abort: AbortController;
  pages: Map<string, Promise<PageSources>>;
  sdks: Map<string, Promise<SdkSources>>;
}
