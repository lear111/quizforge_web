import { object, problem } from './errors.js';

export const RECEIPT_LIMIT = 4;
export function validReceipts(receipts) {
  return Array.isArray(receipts) && receipts.length <= RECEIPT_LIMIT
    && receipts.every(entry => object(entry) && Object.keys(entry).length === 2 && typeof entry.requestId === 'string' && !!entry.requestId.trim() && typeof entry.signature === 'string')
    && new Set(receipts.map(entry => entry.requestId)).size === receipts.length;
}
export function replayed(receipts, requestId, signature) {
  const previous = receipts.find(entry => entry.requestId === requestId);
  if (previous && previous.signature !== signature) throw problem('REQUEST_CONFLICT', '请求标识已用于不同内容。', {}, 409);
  return previous !== undefined;
}
export function appendReceipt(receipts, requestId, signature) {
  return [...receipts.slice(1 - RECEIPT_LIMIT), { requestId, signature }];
}

// Recognition only: these records are cleared, not upgraded.
export function validOldReceipts(value, requireOrder = false) {
  const { receipts, receiptOrder } = value;
  if (!object(receipts) || Object.values(receipts).some(signature => typeof signature !== 'string')) return false;
  if (!Object.hasOwn(value, 'receiptOrder')) return !requireOrder;
  return Array.isArray(receiptOrder) && receiptOrder.length <= RECEIPT_LIMIT && receiptOrder.length === Object.keys(receipts).length
    && new Set(receiptOrder).size === receiptOrder.length && receiptOrder.every(id => typeof id === 'string' && Object.hasOwn(receipts, id));
}
