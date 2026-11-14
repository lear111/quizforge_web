import type { Answered } from './answered.js';
import type { BankInfo, OutlineGroup, OutlineItem } from './bank.js';
import type { GradeResult, StateSummary } from './state.js';

/** Only codes currently emitted by core/server/v2, including public fallbacks. */
export type ApiErrorCode =
  | 'ANSWER_LOCKED'
  | 'ASSET_PATH_INVALID'
  | 'AUTH_REQUIRED'
  | 'BANK_NOT_FOUND'
  | 'BANK_NOT_OPEN'
  | 'BANK_STRUCTURE_INVALID'
  | 'EXTENSION_AMBIGUOUS'
  | 'EXTENSION_INVALID'
  | 'EXTENSION_NOT_FOUND'
  | 'FEATURE_NOT_IMPLEMENTED'
  | 'FILE_COUNT_LIMIT'
  | 'HOST_REJECTED'
  | 'INVALID_CONFIGURATION'
  | 'INVALID_REQUEST'
  | 'INVALID_RESULT'
  | 'JSON_DUPLICATE_KEY'
  | 'JSON_INVALID'
  | 'ORIGIN_REJECTED'
  | 'QUESTION_INVALID'
  | 'QUESTION_NOT_FOUND'
  | 'RANGE_NOT_SATISFIABLE'
  | 'REQUEST_CONFLICT'
  | 'RESOURCE_NOT_FOUND'
  | 'RESULT_CONFLICT'
  | 'REVISION_CONFLICT'
  | 'ROUND_COMPLETED'
  | 'SDK_UNAVAILABLE'
  | 'SNAPSHOT_STALE'
  | 'STATE_INVALID'
  | 'STATE_SIZE_LIMIT'
  | 'STATE_WRITE_FAILED'
  | 'STORAGE_UNAVAILABLE'
  | 'SUBMISSION_STALE'
  | 'V1_API_REMOVED';
export interface ApiError {
  code: ApiErrorCode;
  message: string;
  bankId?: string;
  questionId?: string | null;
  field?: string;
  details?: unknown;
}
export interface ErrorResponse {
  error: ApiError;
}
export interface HealthResponse {
  apiVersion: 2;
  phase: 'segment-1';
  availableFeatures: string[];
}
export interface CatalogResponse {
  groups: {
    id: string;
    name: string;
    items: {
      bankId: string;
      sourceId: string | null;
      title: string;
      kind: 'bank';
      availability: 'available' | 'unavailable';
      error: ApiError | null;
    }[];
  }[];
}
export interface ExtensionDescriptor {
  artifactId: string;
  id: string;
  version: string;
  apiVersion: 2;
  digest: string;
}
export interface ExtensionManifestResponse extends ExtensionDescriptor {
  name: string;
  entries: {
    practice: { html: 'practice-html'; js: 'practice-js'; css: 'practice-css' };
    grade: 'grade-js';
  };
  sdkVersions: Partial<Record<'richtext' | 'answer-area' | 'ink', string>>;
}
export interface QuestionKey {
  bankId: string;
  questionId: string;
  snapshotId: string;
}
/** Writes omit ink; retry and GET include it. They all include the full answer. */
export interface QuestionResponse extends QuestionKey {
  type: string;
  extension: ExtensionDescriptor;
  item: OutlineItem;
  question: unknown;
  solution: unknown;
  answer: unknown;
  result: GradeResult | null;
  submissionId: string | null;
  state: StateSummary;
  resources: { assetId: string; reference: string }[];
  ink?: unknown;
  inkRevision?: number;
}
export interface QuestionReadResponse extends QuestionResponse {
  ink: unknown;
  inkRevision: number;
}
export interface QuestionCandidate<T = QuestionResponse> {
  question: T | null;
  error: ApiError | null;
}
export interface CompletionResponse {
  completedAt: string | null;
  states: StateSummary[];
  total: { score: number; maxScore: number };
}
export interface FinishResponse extends CompletionResponse {
  pendingGrading: QuestionCandidate[];
}
export interface OverviewResponse extends CompletionResponse {
  bank: BankInfo;
  snapshotId: string;
  outline: OutlineGroup[];
  listening: { id: unknown; title: unknown }[];
  questionTypes: { questionId: string; type: string | null }[];
  lastQuestionId: string | null;
  initial: QuestionCandidate<QuestionReadResponse>;
  pendingGrading: QuestionCandidate<QuestionReadResponse>[];
  activeCleared: boolean;
  notice: string | null;
}
export interface RefreshRequest {
  questionId?: string;
  expectedSnapshotId?: string;
}
export interface RefreshResponse extends OverviewResponse {
  changes: {
    activeCleared: boolean;
    addedQuestionIds: string[];
    removedQuestionIds: string[];
    activeRoundInterrupted: false;
  };
}
export interface WriteRequest {
  requestId: string;
  snapshotId: string;
}
export interface VersionedRequest extends WriteRequest {
  expectedRevision: number;
}
export interface AnswerRequest extends VersionedRequest {
  answer: unknown;
  answered?: Answered;
}
export interface InkRequest extends WriteRequest {
  expectedInkRevision: number;
  ink: unknown;
}
export interface InkResponse {
  inkRevision: number;
  state: StateSummary;
}
export type SubmitRequest = Omit<AnswerRequest, 'answered'>;
export type RetryRequest = VersionedRequest;
export interface ResultRequest extends VersionedRequest {
  submissionId: string;
  source: 'grader';
  result: GradeResult;
}
export type ResultEntry = Pick<QuestionKey, 'questionId'> &
  Omit<ResultRequest, 'requestId' | 'snapshotId' | 'source'>;
export type FinishRequest = WriteRequest;
export interface ResultsRequest extends WriteRequest {
  results: ResultEntry[];
}
export interface SnapshotQuery {
  snapshotId: string;
}
export interface OverviewQuery {
  questionId?: string;
}
/** Local listening/assets are binary; remote listening returns this JSON. */
export interface RemoteListeningResponse {
  kind: 'remote';
  src: unknown;
  title: unknown;
}
export type SourceResponse = string;
export type BinaryResponse = Uint8Array;
