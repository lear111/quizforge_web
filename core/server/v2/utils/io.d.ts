import type { FileCache } from '../../host/platform/file-cache.js';
import type { ErrorContext, V2Error } from './errors.js';
export const READ_LIMITS: Readonly<{
  treeItems: number;
  bankBytes: number;
  manifestBytes: number;
  assetBytes: number;
}>;
export function newCache(): FileCache;
export function directories(directory: string): string[];
export function tooMany(context: ErrorContext): V2Error;
export interface TreeIdentity {
  digest: string;
  contentDigest: string;
  hashes: Map<string, string>;
}
export function treeDigest(directory: string, cache: FileCache, context?: ErrorContext): string;
export function treeIdentity(
  directory: string,
  cache: FileCache,
  context?: ErrorContext,
): TreeIdentity;
export function relativePath(directory: string, relative: unknown): string;
export function readJson(
  file: string,
  cache: FileCache,
  maximum: number,
  context?: ErrorContext,
): unknown;
