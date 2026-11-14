import type { Stats, BigIntStats } from 'node:fs';
export interface FileEntry {
  identity: string;
  size: number;
  hash: string;
  content: Buffer | null;
  value?: unknown;
  fingerprints: Map<string, string>;
}
export class FileCache {
  constructor(options?: {
    count?: number;
    bytes?: number;
    digestCount?: number;
    digestBytes?: number;
  });
  entry(file: string, maximum: number): FileEntry;
  hash(file: string, maximum?: number, observed?: BigIntStats | null): string;
  clear(): void;
}
export function statIdentity(stat: Stats | BigIntStats): string;
export function fileIdentity(file: string): string;
