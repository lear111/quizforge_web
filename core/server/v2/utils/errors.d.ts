import type { ApiError, ApiErrorCode } from '../../../shared/v2/api.js';
export interface ErrorContext {
  bankId?: string;
  questionId?: unknown;
  field?: string;
  details?: unknown;
}
export class V2Error extends Error {
  constructor(status: number, code: ApiErrorCode, message: string, context?: ErrorContext);
  status: number;
  code: ApiErrorCode;
  context: ErrorContext;
}
export function object(value: unknown): value is Record<string, unknown>;
export function problem(
  code: ApiErrorCode,
  message: string,
  context?: ErrorContext,
  status?: number,
): V2Error;
export function publicError(error: unknown): ApiError;
