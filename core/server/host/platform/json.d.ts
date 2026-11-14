/** V2's boundary to the existing JSON implementation, including numeric metadata. */
export function parseJson(
  input: string | Uint8Array,
  options?: {
    maxDepth?: number;
    maxStringLength?: number;
    maxNumberLength?: number;
  },
): unknown;
export function stringifyJson(value: unknown, options?: { canonical?: boolean }): string;
export function jsonBytes(value: unknown, options?: { canonical?: boolean }): Buffer;
export function cloneJson<T>(value: T): T;
export function projectJson<T extends object, K extends keyof T>(
  value: T,
  fields: readonly K[],
): Pick<T, K>;
export function shallowCopyJson<T extends object>(value: T): T;
export function patchJson<T extends object, P extends object>(
  value: T,
  fields: P,
): Omit<T, keyof P> & P;
export function freezeJson<T>(value: T, options?: { incremental?: boolean }): T;
export function fingerprint(value: unknown, namespace: string): string;
export function hash(bytes: import('node:crypto').BinaryLike): string;
export function jsonEqual(left: unknown, right: unknown): boolean;
export function integralField(parent: unknown, key: PropertyKey): boolean;
export function decimalSum(values: Iterable<number>): number;
