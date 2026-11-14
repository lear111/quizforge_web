import type { CurrentState, LegacyState, LoadedState } from '../types/data.js';
import type { V2Error } from './errors.js';
export function integer(value: unknown): value is number;
export function own(value: LoadedState, key: 'historyIndex'): value is LegacyState;
export function own<T extends object, K extends PropertyKey>(
  value: T,
  key: K,
): value is T & Record<K, unknown>;
export function invalid(): V2Error;
export function increment(value: number): number;
export function empty(): CurrentState;
