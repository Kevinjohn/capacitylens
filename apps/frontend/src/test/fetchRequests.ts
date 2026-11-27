/**
 * Reads what a fake `fetch` receives. The API client passes a Request that carries the method,
 * headers and body; `init` may carry headers and the deadline signal. Each reader combines the
 * two as `fetch` itself does, with `new Request(input, init)`.
 */

/** One fetch call, normalised to what it sends. */
export interface FetchRequest {
  /** Encoded path and query, e.g. `/api/v1/companies/a%20b/members?cursor=x`. */
  path: string
  url: URL
  method: string
  headers: Headers
  credentials: RequestCredentials
  /** The request's signal, which follows the signal the caller passed. */
  signal: AbortSignal
  /** The request body as text, or null when none was sent. */
  body: string | null
}

/** A fetch input and init as the fake received them. */
type FetchCall = readonly [RequestInfo | URL, RequestInit | undefined]

function toRequest(input: RequestInfo | URL, init?: RequestInit): Request {
  const source =
    input instanceof Request ? input.clone() : new URL(String(input), window.location.origin)
  return new Request(source, init)
}

/** The method and encoded path and query of a fetch call, read at once without its body. */
export function readRequestTarget(
  input: RequestInfo | URL,
  init?: RequestInit
): { method: string; path: string } {
  const url = new URL(input instanceof Request ? input.url : String(input), window.location.origin)
  const method = init?.method ?? (input instanceof Request ? input.method : 'GET')
  return { method: method.toUpperCase(), path: `${url.pathname}${url.search}` }
}

/**
 * Read one fetch call. The Request is copied before the first await, so call this from inside the
 * fake: the client consumes its Request once the fake returns.
 */
export async function readFetchRequest(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<FetchRequest> {
  const request = toRequest(input, init)
  const url = new URL(request.url)
  return {
    path: `${url.pathname}${url.search}`,
    url,
    method: request.method,
    headers: request.headers,
    credentials: request.credentials,
    signal: request.signal,
    body: request.body === null ? null : await request.text(),
  }
}

/**
 * Read every call a fetch mock received, in call order, after the requests are made. A request
 * body may be consumed by then, so record calls with a body through {@link createRequestLog}.
 */
export function readFetchCalls(fetchMock: {
  mock: { calls: ReadonlyArray<ReadonlyArray<unknown>> }
}): Promise<FetchRequest[]> {
  return Promise.all(
    fetchMock.mock.calls.map(([input, init]) =>
      readFetchRequest(input as RequestInfo | URL, init as RequestInit | undefined)
    )
  )
}

/** Records what a fake fetch is sent, copying each call as it arrives so it can be read later. */
export interface RequestLog {
  /** Copy one fetch call; call it from the fake before returning. */
  record(input: RequestInfo | URL, init?: RequestInit): void
  /** Every recorded call normalised to what it sends, in order. */
  read(): Promise<FetchRequest[]>
  clear(): void
}

/** Create an empty request log. */
export function createRequestLog(): RequestLog {
  const calls: FetchCall[] = []
  return {
    record(input, init) {
      calls.push([input instanceof Request ? input.clone() : input, init])
    },
    read: () => Promise.all(calls.map(([input, init]) => readFetchRequest(input, init))),
    clear() {
      calls.length = 0
    },
  }
}
