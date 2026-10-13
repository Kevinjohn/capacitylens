/** Converts the generated client's native request into the established injected-fetch boundary. */
export function normalizeNativeBatchRequest(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  body: string,
): { url: string; init: RequestInit } {
  const request = input instanceof Request ? input : new Request(input, init);
  return {
    url: request.url,
    init: {
      ...init,
      body,
      cache: request.cache,
      credentials: request.credentials,
      headers: request.headers,
      integrity: request.integrity,
      keepalive: request.keepalive,
      method: request.method,
      mode: request.mode,
      redirect: request.redirect,
      referrer: request.referrer,
      referrerPolicy: request.referrerPolicy,
      signal: request.signal,
    },
  };
}
