/** What a fake fetch received, read from the client's Request and the init passed beside it. */
export interface SentRequest {
  /** Encoded path and query, e.g. `/api/v1/companies/a%20b/members?cursor=x`. */
  path: string;
  url: URL;
  method: string;
  headers: Headers;
  credentials: RequestCredentials;
  signal: AbortSignal;
  /** The request body as text, or null when none was sent. */
  body: string | null;
}

/** A fetch input and init, with any Request copied when it was sent. */
type RecordedCall = readonly [RequestInfo | URL, RequestInit | undefined];

/**
 * Records what a fake fetch is sent. The client passes a Request whose method, headers and body
 * live on the Request itself, and the client uses that Request up once the fake returns, so each
 * call is copied as it arrives and read later.
 */
export interface RequestLog {
  /** Copy one fetch call; call it from the fake before returning. */
  record(input: RequestInfo | URL, init?: RequestInit): void;
  /** Every recorded call normalised to what it sends, in order. */
  read(): Promise<SentRequest[]>;
  clear(): void;
}

/** Create an empty request log. */
export function createRequestLog(): RequestLog {
  const calls: RecordedCall[] = [];
  return {
    record(input, init) {
      calls.push([input instanceof Request ? input.clone() : input, init]);
    },
    read: () => Promise.all(calls.map(([input, init]) => readSentRequest(input, init))),
    clear() {
      calls.length = 0;
    },
  };
}

async function readSentRequest(input: RequestInfo | URL, init?: RequestInit): Promise<SentRequest> {
  const request = new Request(input, init);
  const url = new URL(request.url);
  const body = request.body === null ? null : await request.text();
  return {
    path: `${url.pathname}${url.search}`,
    url,
    method: request.method,
    headers: request.headers,
    credentials: request.credentials,
    signal: request.signal,
    body,
  };
}

/** The method and encoded path and query of a fetch call, read at once without its body. */
export function readRequestTarget(
  input: RequestInfo | URL,
  init?: RequestInit,
): { method: string; path: string } {
  const url = new URL(input instanceof Request ? input.url : String(input), window.location.origin);
  const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
  return { method: method.toUpperCase(), path: `${url.pathname}${url.search}` };
}
