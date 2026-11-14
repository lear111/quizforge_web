import type { Request, RequestHandler, Response } from 'express';
import type { IncomingMessage } from 'node:http';
import type { LibrarySnapshots } from '../services/bank.service.js';

export interface Locals {
  target: URL;
  parts: string[];
  input?: unknown;
}
export type HttpResponse = Response<unknown, Locals>;
export type Handler = RequestHandler<
  Record<string, string>,
  unknown,
  unknown,
  Record<string, unknown>,
  Locals
>;
export type SdkParams = { component: string; version: string; entry: string[] };
export type SdkHandler = RequestHandler<
  SdkParams,
  unknown,
  unknown,
  Record<string, unknown>,
  Locals
>;
export type HttpRequest = Request<
  Record<string, string>,
  unknown,
  unknown,
  Record<string, unknown>,
  Locals
>;
export interface BinaryOptions {
  executable?: boolean;
  expectedHash?: string;
}
export interface ServerContext {
  library: LibrarySnapshots;
  codeRoot: string;
  timings: boolean;
  binary(
    request: IncomingMessage,
    response: HttpResponse,
    file: string,
    options?: BinaryOptions,
  ): void;
  immutable(response: HttpResponse): void;
}
export type Handlers = Record<
  | 'rootPage'
  | 'health'
  | 'catalog'
  | 'ui'
  | 'overview'
  | 'question'
  | 'refresh'
  | 'finish'
  | 'results'
  | 'answer'
  | 'ink'
  | 'result'
  | 'retry'
  | 'submit'
  | 'asset'
  | 'listening'
  | 'manifest'
  | 'extensionFile'
  | 'unknownExtensionRoute',
  Handler
> & {
  sdk: SdkHandler;
};

export type QuestionOperation = 'answer' | 'ink' | 'result' | 'retry' | 'submit';
export type QuestionHandlers = Pick<Handlers, QuestionOperation>;
export type BankHandlers = QuestionHandlers &
  Pick<Handlers, 'overview' | 'question' | 'refresh' | 'finish' | 'results'>;
