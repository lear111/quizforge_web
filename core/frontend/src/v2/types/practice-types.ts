import type { Ref } from 'vue';
import type { PracticeApi } from '../api';
import type {
  CompletionResponse,
  FinishResponse,
  OverviewResponse as Overview,
} from '../../../../shared/v2/api.js';
export type {
  QuestionResponse as Question,
  OverviewResponse as Overview,
} from '../../../../shared/v2/api.js';
export type Completion = CompletionResponse & Partial<Pick<FinishResponse, 'pendingGrading'>>;

export interface PracticeWorkspace {
  overview: Ref<Overview | null>;
  message: Ref<string>;
  busy: Ref<boolean>;
  token: Ref<string>;
  api: PracticeApi;
  run(label: string, action: () => Promise<void>): Promise<void>;
}
