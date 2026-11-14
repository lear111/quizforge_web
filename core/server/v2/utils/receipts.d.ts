import type { Receipt } from '../../../shared/v2/state.js';
export const RECEIPT_LIMIT: 4;
export function validReceipts(value: unknown): value is Receipt[];
export function replayed(
  receipts: readonly Receipt[],
  requestId: string,
  signature: string,
): boolean;
export function appendReceipt(
  receipts: readonly Receipt[],
  requestId: string,
  signature: string,
): Receipt[];
export function validOldReceipts(value: Record<string, unknown>, requireOrder?: boolean): boolean;
