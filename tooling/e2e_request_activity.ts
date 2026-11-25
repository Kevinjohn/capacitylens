import type { IncomingMessage, Server, ServerResponse } from 'node:http';

type RequestHandler = (request: IncomingMessage, response: ServerResponse) => void | Promise<void>;

type RequestEntry = { method: string; path: string; startedAt: number };

/** The header naming the test an `/api/` request belongs to. */
export const E2E_TAG_HEADER = 'x-e2e-epoch';
/** The control request: `POST /__e2e/epoch?next=<tag>` makes `<tag>` current, then settles. */
export const E2E_TAG_PATH = '/__e2e/epoch';

const TAG_PATTERN = /^[A-Za-z0-9-]{1,64}$/;
const DEFAULT_SETTLE_TIMEOUT_MS = 5_000;

/**
 * Installs request accounting and the per-test request tag on a reset-enabled server.
 *
 * A database reset is atomic when no handler from the previous test is still running as the
 * restore starts, and none can start after it. The control request sets the new tag first, so
 * from that moment any `/api/` request carrying another tag is refused before it reaches the
 * application, and then answers only once every running handler has finished. Enforcement starts
 * with the first tag: a server that never receives a control request (the auth-backed browser
 * server) handles every request as usual.
 */
export function installE2eRequestActivity(
  server: Server,
  handler: RequestHandler,
  { settleTimeoutMs = DEFAULT_SETTLE_TIMEOUT_MS }: { settleTimeoutMs?: number } = {},
): void {
  const pending = new Map<symbol, RequestEntry>();
  let currentTag: string | undefined;

  server.on('request', (request, response) => {
    void handle(request, response).catch((error: unknown) => {
      response.destroy(error instanceof Error ? error : new Error(String(error)));
    });
  });

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const [path = '', query = ''] = (request.url ?? '').split('?', 2);
    if (path === E2E_TAG_PATH) {
      if (request.method !== 'POST') return answer(response, 405, { error: 'Use POST.' });
      const next = new URLSearchParams(query).get('next') ?? '';
      if (!TAG_PATTERN.test(next))
        return answer(response, 400, { error: 'The next tag must be 1-64 letters, digits or -.' });
      // The tag changes before the wait, so the previous test cannot start new work meanwhile.
      currentTag = next;
      try {
        await waitForNoRequests(pending, settleTimeoutMs);
      } catch (error) {
        return answer(response, 503, { error: (error as Error).message });
      }
      return answer(response, 200, { tag: next });
    }

    if (
      currentTag !== undefined &&
      path.startsWith('/api/') &&
      request.headers[E2E_TAG_HEADER] !== currentTag
    )
      return answer(response, 409, {
        error: `stale e2e epoch: ${request.method} ${path} does not carry the current test's ${E2E_TAG_HEADER} header.`,
      });

    const key = Symbol();
    pending.set(key, { method: request.method ?? 'UNKNOWN', path, startedAt: Date.now() });
    try {
      await handler(request, response);
    } finally {
      pending.delete(key);
    }
  }
}

function answer(response: ServerResponse, status: number, body: Record<string, unknown>): void {
  response.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
  });
  response.end(JSON.stringify(body));
}

async function waitForNoRequests(pending: Map<symbol, RequestEntry>, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (pending.size > 0) {
    if (Date.now() >= deadline) {
      const requests = Array.from(pending.values(), ({ method, path, startedAt }) => ({
        method,
        path,
        elapsedMs: Date.now() - startedAt,
      }));
      throw new Error(
        `Requests did not settle within ${timeoutMs} ms; ${pending.size} handlers still running: ${JSON.stringify(requests)}.`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
