import { chmod, lstat, unlink } from 'node:fs/promises';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import net, { type Server as NetServer, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export type ResetControlRole = 'api' | 'vite';
export type ResetControlCommand = 'status' | 'pause' | 'resume';

const maxFrameBytes = 16 * 1024;
const defaultControlTimeoutMs = 5_000;

export function createResetControlToken(): string {
  return randomBytes(16).toString('hex');
}

function assertToken(token: string): void {
  if (!/^[a-f0-9]{32}$/.test(token)) throw new Error('Reset control token is invalid.');
}

export function resetControlEndpoint(token: string, role: ResetControlRole): string {
  assertToken(token);
  if (process.platform === 'win32') return `\\\\.\\pipe\\clreset-${token}-${role}`;
  const endpoint = join(tmpdir(), `clr-${token}-${role}.sock`);
  if (Buffer.byteLength(endpoint) >= 100) {
    throw new Error('The temporary directory path is too long for a reset control socket.');
  }
  return endpoint;
}

function encodeFrame(value: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(value));
  if (body.length > maxFrameBytes) throw new Error('Reset control message is too large.');
  const frame = Buffer.allocUnsafe(4 + body.length);
  frame.writeUInt32BE(body.length, 0);
  body.copy(frame, 4);
  return frame;
}

function parseFrame(buffer: Buffer): { body: Buffer; rest: Buffer } | undefined {
  if (buffer.length < 4) return undefined;
  const length = buffer.readUInt32BE(0);
  if (length > maxFrameBytes) throw new Error('Reset control message is too large.');
  if (buffer.length < 4 + length) return undefined;
  return { body: buffer.subarray(4, 4 + length), rest: buffer.subarray(4 + length) };
}

function bounded<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${timeoutMs} ms.`)),
      timeoutMs
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function equalToken(left: unknown, right: string): boolean {
  if (typeof left !== 'string' || !/^[a-f0-9]{32}$/.test(left)) return false;
  return timingSafeEqual(Buffer.from(left), Buffer.from(right));
}

export class ResetControlError extends Error {
  readonly role: ResetControlRole;
  readonly command: ResetControlCommand;
  readonly state?: unknown;

  constructor(
    message: string,
    role: ResetControlRole,
    command: ResetControlCommand,
    state?: unknown,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.role = role;
    this.command = command;
    this.state = state;
  }
}

export function createResetControlServer(
  token: string,
  role: ResetControlRole,
  handlers: {
    status(): unknown;
    pause(timeoutMs: number): Promise<unknown>;
    resume(timeoutMs: number): Promise<unknown>;
  }
): { ready: Promise<void>; close(): Promise<void> } {
  assertToken(token);
  const endpoint = resetControlEndpoint(token, role);
  const clients = new Set<Socket>();
  const server: NetServer = net.createServer((socket) => {
    clients.add(socket);
    const requestTimeout = setTimeout(
      () => socket.destroy(new Error('Reset control request timed out.')),
      2_000
    );
    socket.once('close', () => {
      clearTimeout(requestTimeout);
      clients.delete(socket);
    });
    socket.on('error', () => socket.destroy());
    let accepted = false;
    let buffered: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    socket.on('data', (chunk: Buffer) => {
      if (accepted) {
        socket.destroy(new Error('Reset control accepts one command per connection.'));
        return;
      }
      buffered = Buffer.concat([buffered, chunk]);
      if (buffered.length > maxFrameBytes + 4) {
        socket.destroy(new Error('Reset control message is too large.'));
        return;
      }
      let frame: ReturnType<typeof parseFrame>;
      try {
        frame = parseFrame(buffered);
      } catch (error) {
        socket.destroy(error as Error);
        return;
      }
      if (!frame) return;
      if (frame.rest.length !== 0) {
        socket.destroy(new Error('Reset control accepts one command per connection.'));
        return;
      }
      accepted = true;
      clearTimeout(requestTimeout);
      void respond(socket, frame.body);
    });
  });

  async function respond(socket: Socket, body: Buffer): Promise<void> {
    let roleCommand: ResetControlCommand = 'status';
    try {
      const request = JSON.parse(body.toString('utf8')) as {
        token?: unknown;
        command?: unknown;
        timeoutMs?: unknown;
      };
      if (!equalToken(request.token, token)) {
        throw new Error('Reset control authentication failed.');
      }
      if (!['status', 'pause', 'resume'].includes(request.command as string)) {
        throw new Error('Reset control command is invalid.');
      }
      roleCommand = request.command as ResetControlCommand;
      const timeoutMs =
        Number.isInteger(request.timeoutMs) && Number(request.timeoutMs) > 0
          ? Math.min(Number(request.timeoutMs), defaultControlTimeoutMs)
          : defaultControlTimeoutMs;
      const state =
        roleCommand === 'pause'
          ? await handlers.pause(timeoutMs)
          : roleCommand === 'resume'
            ? await handlers.resume(timeoutMs)
            : handlers.status();
      if (!socket.destroyed) {
        socket.end(encodeFrame({ ok: true, role, command: roleCommand, state }));
      }
    } catch (error) {
      if (!socket.destroyed) {
        socket.end(
          encodeFrame({
            ok: false,
            role,
            command: roleCommand,
            error: error instanceof Error ? error.message : String(error),
            state: handlers.status(),
          })
        );
      }
    }
  }

  const ready = new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      if (process.platform === 'win32') resolve();
      else void chmod(endpoint, 0o600).then(resolve, reject);
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(endpoint);
  });
  return {
    ready,
    async close() {
      for (const client of clients) client.destroy();
      if (server.listening) {
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve()))
        );
      }
      await cleanupResetControlEndpoint(token, role);
    },
  };
}

export async function requestResetControl(
  token: string,
  role: ResetControlRole,
  command: ResetControlCommand,
  timeoutMs = defaultControlTimeoutMs
): Promise<unknown> {
  assertToken(token);
  const endpoint = resetControlEndpoint(token, role);
  const payload = encodeFrame({ token, command, timeoutMs });
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(endpoint);
    let settled = false;
    let buffered: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    const clientTimeoutMs = timeoutMs + 250;
    const finish = (error?: Error, value?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (error) {
        reject(
          error instanceof ResetControlError
            ? error
            : new ResetControlError(error.message, role, command, undefined, { cause: error })
        );
      } else resolve(value);
    };
    const timer = setTimeout(
      () =>
        finish(
          new Error(`${role} reset control ${command} timed out after ${clientTimeoutMs} ms.`)
        ),
      clientTimeoutMs
    );
    socket.on('error', (error) => finish(error));
    socket.once('close', () => {
      if (!settled) {
        finish(new Error(`${role} reset control ${command} closed before a complete response.`));
      }
    });
    socket.once('connect', () => socket.write(payload));
    socket.on('data', (chunk) => {
      if (settled) return;
      buffered = Buffer.concat([buffered, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);
      try {
        const frame = parseFrame(buffered);
        if (!frame) return;
        const response = JSON.parse(frame.body.toString('utf8')) as {
          ok?: boolean;
          role?: string;
          command?: string;
          error?: string;
          state?: unknown;
        };
        if (response.role !== role || response.command !== command) {
          throw new Error('Reset control response did not match the requested role and command.');
        }
        if (response.ok === true) finish(undefined, response.state);
        else if (response.ok === false) {
          finish(
            new ResetControlError(
              response.error ?? `Reset control ${command} failed.`,
              role,
              command,
              response.state
            )
          );
        } else throw new Error('Reset control response has an invalid outcome.');
      } catch (error) {
        finish(error as Error);
      }
    });
  });
}

export async function cleanupResetControlEndpoints(token: string): Promise<void> {
  for (const role of ['api', 'vite'] as const) await cleanupResetControlEndpoint(token, role);
}

async function cleanupResetControlEndpoint(token: string, role: ResetControlRole): Promise<void> {
  if (process.platform === 'win32') {
    return;
  }
  const endpoint = resetControlEndpoint(token, role);
  try {
    const entry = await lstat(endpoint);
    const getUid = Reflect.get(process, 'getuid') as (() => number) | undefined;
    if (typeof getUid !== 'function' || !entry.isSocket() || entry.uid !== getUid.call(process)) {
      throw new Error(`Refusing to remove an unowned reset control endpoint: ${endpoint}`);
    }
    await unlink(endpoint);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

export function createRetirableListener(
  server: import('node:net').Server,
  options: {
    role: ResetControlRole;
    listen(): Promise<void>;
    waitForQuiescence(timeoutMs: number): Promise<unknown>;
    status(): Record<string, unknown>;
  }
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
      if (!paused) paused = true;
      const deadline = Date.now() + timeoutMs;
      const listenerClosed = new Promise<void>((resolve, reject) => {
        try {
          server.close((error) => (error ? reject(error) : resolve()));
        } catch (error) {
          reject(error);
        }
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
          `${options.role} socket retirement`
        );
        const quiescence = bounded(
          options.waitForQuiescence(Math.max(1, remaining() - 100)),
          remaining(),
          `${options.role} request drain`
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
  label: string
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(`${label} did not drain within ${timeoutMs} ms.`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
