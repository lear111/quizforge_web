import type { BankInfo, OutlineGroup, OutlineItem } from '../../../shared/v2/bank.js';
import type {
  ApiError,
  ExtensionDescriptor,
  ExtensionManifestResponse,
} from '../../../shared/v2/api.js';
import type { StateFile, QuestionState } from '../../../shared/v2/state.js';

export interface BankLocation {
  directory: string;
  group: string;
  name: string;
  bankId: string;
}
export interface ListeningEntry {
  id: unknown;
  title: unknown;
  src: unknown;
  remote: boolean;
}
export interface ReadBank {
  raw: Record<string, unknown> & { outline: OutlineGroup[] };
  items: Map<string, OutlineItem>;
  maxScores: Map<string, number>;
  listening: Map<unknown, ListeningEntry>;
  info: BankInfo;
}
export type SdkVersions = ExtensionManifestResponse['sdkVersions'];
export interface IdentifiedManifest extends Record<string, unknown> {
  id: string;
  version: string;
}
export interface CheckedManifest extends IdentifiedManifest {
  name: string;
  development?: boolean;
}
export interface Artifact {
  directory: string;
  manifest: CheckedManifest;
  files: Map<string, string>;
  hashes: Map<string, string>;
  sdkVersions: SdkVersions;
  contentDigest: string;
  development: boolean;
  descriptor: ExtensionDescriptor;
}
export type Resolution =
  { artifact: Artifact; error?: never } | { artifact?: never; error: ApiError };
export interface SdkEntry {
  directory: string;
  digest: string;
  hashes: Map<string, string>;
}
export interface Snapshot extends ReadBank, BankLocation {
  snapshotId: string;
  contentFingerprint: string;
  resolutions: Map<string, Resolution>;
  sdk: Map<string, SdkEntry>;
  hashes: Map<string, string>;
  activeCleared?: boolean;
}
/** Existing development records are recognized then cleared, never upgraded. */
export interface LegacyState extends Record<string, unknown> {
  formatVersion: 2;
  historyIndex: unknown[];
  questions: Record<string, unknown>;
  completedAt?: string | null;
  contentFingerprint?: unknown;
  lastQuestionId?: unknown;
}
export interface CurrentState extends Omit<StateFile, 'contentFingerprint' | 'lastQuestionId'> {
  contentFingerprint?: unknown;
  lastQuestionId?: unknown;
  historyIndex?: never;
  questions: Record<string, QuestionState>;
}
export type LoadedState = CurrentState | LegacyState;

export interface CheckedQuestion extends Record<string, unknown> {
  question: Record<string, unknown>;
  solution: Record<string, unknown>;
}

export type TailArgs<T extends readonly unknown[]> = T extends readonly [unknown, ...infer Rest]
  ? Rest
  : never;

export interface PracticeOptions {
  write?: typeof import('../../host/platform/files.js').replaceFile;
  uuid?: () => string;
  now?: () => unknown;
  inkStore?: import('../repositories/ink.repository.js').PracticeInk;
}
export interface OverviewOptions {
  requestedQuestionId: string | undefined;
  lastQuestionId: string | null;
  includeInitial: boolean;
  refresh: boolean;
  previous: Snapshot | undefined;
}

export type OpenedSnapshot = Snapshot & { activeCleared: boolean };
export type QuestionType = Pick<import('../../../shared/v2/bank.js').BankQuestion, 'type'>;
