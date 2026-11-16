import { createClient, type ClientOptions } from './client';
import { createCatalogApi } from './catalog';
import { createBankApi } from './banks';
import { createQuestionApi } from './questions';
import { createExtensionApi } from './extensions';
import { createSdkApi } from './sdk';
import { createHistoryApi } from './history';

export function createApi(options: ClientOptions) {
  const client = createClient(options);
  return {
    catalog: createCatalogApi(client),
    banks: createBankApi(client),
    questions: createQuestionApi(client),
    extensions: createExtensionApi(client),
    sdk: createSdkApi(client),
    history: createHistoryApi(client),
  };
}
export type PracticeApi = ReturnType<typeof createApi>;
