import type { IncomingMessage } from 'node:http';
import type { FileEntry } from '../../host/platform/file-cache.js';
import type { BinaryOptions, Handler, HttpResponse, ServerContext } from '../types/http.js';
export function json(response: HttpResponse, status: number, value: unknown): void;
export const rootPage: Handler;
export function immutable(response: HttpResponse): void;
export function writeBinary(
  server: ServerContext,
  request: IncomingMessage,
  response: HttpResponse,
  file: string,
  entry: FileEntry,
  options?: BinaryOptions,
): void;
