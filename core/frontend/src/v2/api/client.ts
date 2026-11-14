export interface ClientOptions {
  token(): string;
  unauthorized(): void;
  fetch?: typeof fetch;
}

// One transport for JSON, source files and binary resources. Credentials and
// server errors must behave identically regardless of the resource requested.
export function createClient(options: ClientOptions) {
  async function response(route: string, init: RequestInit = {}) {
    const token = options.token();
    const response = await (options.fetch ?? fetch)(route, {
      ...init,
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      headers: { ...init.headers, ...(token ? { 'x-quizforge-token': token } : {}) },
    });
    if (!response.ok) {
      const body = await response.json();
      if (response.status === 401) {
        options.unauthorized();
      }
      throw Object.assign(new Error(body.error?.message || '操作未完成。'), {
        code: body.error?.code,
        questionId: body.error?.questionId,
        status: response.status,
      });
    }
    return response;
  }
  return {
    response,
    json: async <T>(route: string, init?: RequestInit): Promise<T> =>
      (await response(route, init)).json(),
    text: async (route: string, init?: RequestInit): Promise<string> =>
      (await response(route, init)).text(),
  };
}
export type ApiClient = ReturnType<typeof createClient>;

export const jsonRequest = (method: string, body: string): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body,
});
