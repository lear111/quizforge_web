import type { QuestionResponse, InkResponse } from '../../../../shared/v2/api.js';

// These tags are host-only metadata, never part of the HTTP body or response.
export interface SaveResponses {
  answer: QuestionResponse;
  ink: InkResponse;
}
export interface PreparedSave<K extends keyof SaveResponses = keyof SaveResponses> {
  kind: K;
  route: string;
  body: string;
}
export type SavedOperation =
  { kind: 'answer'; value: QuestionResponse } | { kind: 'ink'; value: InkResponse };
