import type { Stats, BigIntStats } from 'node:fs';
interface StatOptions {
  directory?: boolean;
  optional?: boolean;
  bigint?: boolean;
  observed?: Stats | BigIntStats | null;
}
export function checkedStat(
  file: string,
  options: StatOptions & { bigint: true; optional: true; observed?: BigIntStats | null },
): { absolute: string; stat: BigIntStats | null };
export function checkedStat(
  file: string,
  options: StatOptions & { bigint: true; optional?: false; observed?: BigIntStats | null },
): { absolute: string; stat: BigIntStats };
export function checkedStat(
  file: string,
  options: StatOptions & { bigint?: false; optional: true; observed?: Stats | null },
): { absolute: string; stat: Stats | null };
export function checkedStat(
  file: string,
  options?: StatOptions & { bigint?: false; optional?: false; observed?: Stats | null },
): { absolute: string; stat: Stats };
export function checkPath(file: string, options?: StatOptions): string;
export function within(base: string, candidate: string): boolean;
export function readBytes(file: string, maximum: number, optional: true): Buffer | null;
export function readBytes(file: string, maximum?: number, optional?: false): Buffer;
export function replaceFile(file: string, bytes: Uint8Array): void;
