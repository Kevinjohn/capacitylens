import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { createResetControlServer, createRetirableListener } from '#start/e2e_reset_control';

type RequestHandler = (request: IncomingMessage, response: ServerResponse) => void | Promise<void>;

type RequestActivityOptions = {
  enabled: boolean;
  token?: string;
  host: string;
  port: number;
};

type RequestEntry = { method: string; path: string; startedAt: number };

/** Installs native request accounting and the isolated worker's pause/resume control channel. */
export function installE2eRequestActivity(
  server: Server,
  handler: RequestHandler,
  options: RequestActivityOptions
): { ready: Promise<void>; close(): Promise<void> } | undefined {
  if (!options.enabled) {
    server.on('request', (request, response) => {
      void Promise.resolve(handler(request, response)).catch((error: unknown) => {
        response.destroy(error instanceof Error ? error : new Error(String(error)));
      });
    });
    return undefined;
  }

  const pending = new Map<symbol, RequestEntry>();
  const listener = options.token
    ? createRetirableListener(server, {
        role: 'api',
        listen: () => listen(server, options.port, options.host),
        async waitForQuiescence(timeoutMs) {
          await waitForNoRequests(pending, timeoutMs);
          return activity(pending);
        },
        status: () => activity(pending),
      })
    : undefined;
  const control =
    options.token && listener
      ? createResetControlServer(options.token, 'api', {
          status: listener.status,
          pause: listener.pause,
          resume: listener.resume,
        })
      : undefined;

  server.on('request', (request, response) => {
    void handle(request, response).catch((error: unknown) => {
      response.destroy(error instanceof Error ? error : new Error(String(error)));
    });
  });

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (listener && listener.shouldReject(request.socket)) {
      request.socket.destroy();
      return;
    }

    const path = request.url?.split('?', 1)[0] ?? '';
    if (request.method === 'GET' && path === '/api/health/e2e-idle') {
      response.writeHead(200, {
        'cache-control': 'no-store',
        'content-type': 'application/json; charset=utf-8',
      });
      response.end(JSON.stringify(activity(pending, true)));
      return;
    }

    const key = Symbol();
    pending.set(key, { method: request.method ?? 'UNKNOWN', path, startedAt: Date.now() });
    try {
      await handler(request, response);
    } finally {
      pending.delete(key);
    }
  }

  return control;
}

function activity(pending: Map<symbol, RequestEntry>, includeDetails = false) {
  return {
    activeRequests: pending.size,
    ...(includeDetails
      ? {
          pendingRequests: Array.from(pending.values(), ({ method, path, startedAt }) => ({
            method,
            path,
            elapsedMs: Math.max(0, Date.now() - startedAt),
          })),
        }
      : {}),
  };
}

async function waitForNoRequests(pending: Map<symbol, RequestEntry>, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (pending.size > 0) {
    if (Date.now() >= deadline) {
      const requests = Array.from(pending.values(), ({ method, path }) => ({ method, path }));
      throw new Error(
        `API pause timed out with ${pending.size} active handlers: ${JSON.stringify(requests)}.`
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function listen(server: Server, port: number, host: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
}
