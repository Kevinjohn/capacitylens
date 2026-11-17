import type { Server as NetServer, Socket } from 'node:net';
import type { ResetControlRole } from './e2e_reset_control.ts';

/**
 * Lets an e2e worker's HTTP listener be retired and restored around a database reset: pausing
 * closes the listener, destroys open sockets and waits for in-flight requests to drain, and
 * resuming listens again.
 */
export function createRetirableListener(
  server: NetServer,
  options: {
    role: ResetControlRole;
    listen(): Promise<void>;
    waitForQuiescence(timeoutMs: number): Promise<unknown>;
    status(): Record<string, unknown>;
  },
): {
  shouldReject(socket: Socket): boolean;
  status(): Record<string, unknown>;
  pause(timeoutMs: number): Promise<unknown>;
  resume(timeoutMs: number): Promise<unknown>;
} {
  let paused = false;
  const sockets = new Set<Socket>();
  const retired = new WeakSet<Socket>();
  const onConnection = (socket: Socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
    if (paused) {
      retired.add(socket);
      socket.destroy();
    }
  };
  server.on('connection', onConnection);

  const status = () => ({
    ...options.status(),
    paused,
    listening: server.listening,
    openSockets: sockets.size,
  });

  return {
    shouldReject: (socket) => paused || retired.has(socket),
    status,
    async pause(timeoutMs) {
      paused = true;
      const deadline = Date.now() + timeoutMs;
      const listenerClosed = new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
      for (const socket of sockets) {
        retired.add(socket);
        socket.destroy();
      }
      const remaining = () => Math.max(1, deadline - Date.now());
      try {
        const closed = bounded(listenerClosed, remaining(), `${options.role} listener close`);
        const retiredSockets = bounded(
          waitUntil(() => sockets.size === 0, remaining(), `${options.role} sockets`),
          remaining(),
          `${options.role} socket retirement`,
        );
        const quiescence = bounded(
          options.waitForQuiescence(Math.max(1, remaining() - 100)),
          remaining(),
          `${options.role} request drain`,
        );
        const [, drainState] = await Promise.all([closed, quiescence, retiredSockets]);
        return { ...status(), drain: drainState };
      } catch (error) {
        throw new Error(`${options.role} pause failed: ${(error as Error).message}`, {
          cause: error,
        });
      }
    },
    async resume(timeoutMs) {
      if (!paused) return status();
      const listening = new Promise<void>((resolve, reject) => {
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
        try {
          void options.listen().catch(reject);
        } catch (error) {
          reject(error);
        }
      });
      await bounded(listening, timeoutMs, `${options.role} listener resume`);
      paused = false;
      return status();
    },
  };
}

async function waitUntil(
  predicate: () => boolean,
  timeoutMs: number,
  label: string,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(`${label} did not drain within ${timeoutMs} ms.`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function bounded<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${timeoutMs} ms.`)),
      timeoutMs,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
