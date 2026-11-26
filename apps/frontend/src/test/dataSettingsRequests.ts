/** A fetch call made through the API client, read back for data and settings test assertions. */
export interface DataSettingsRequest {
  /** Absolute request URL. */
  url: string;
  /** Path and query, without the origin. */
  path: string;
  method: string;
  headers: Headers;
  credentials: RequestCredentials;
  signal: AbortSignal | null;
  /** Parsed JSON body, the raw text when it is not JSON, or undefined when there is no body. */
  body: unknown;
}

/**
 * Normalise the `(input, init)` pair a fake fetch receives. The API client passes a Request that
 * carries the method, headers and body; `init` may add headers and the deadline signal.
 */
export async function readDataSettingsRequest(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<DataSettingsRequest> {
  const request = input instanceof Request ? input.clone() : new Request(String(input), init);
  const headers = new Headers(request.headers);
  new Headers(init?.headers).forEach((value, name) => headers.set(name, value));
  const text = await request.text();
  let body: unknown;
  if (text !== '') {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  const url = new URL(request.url);
  return {
    url: request.url,
    path: `${url.pathname}${url.search}`,
    method: (init?.method ?? request.method).toUpperCase(),
    headers,
    credentials: init?.credentials ?? request.credentials,
    signal: init?.signal ?? null,
    body,
  };
}

/**
 * Read every call a fake fetch received, in call order, after the requests are made. A request
 * body may be unreadable by then, so read a request with a body inside the fake instead.
 */
export function readDataSettingsCalls(fetchMock: {
  mock: { calls: ReadonlyArray<ReadonlyArray<unknown>> };
}): Promise<DataSettingsRequest[]> {
  return Promise.all(
    fetchMock.mock.calls.map(([input, init]) =>
      readDataSettingsRequest(input as RequestInfo | URL, init as RequestInit | undefined),
    ),
  );
}
