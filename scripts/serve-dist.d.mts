import type { RequestListener } from "node:http";
import type { Readable } from "node:stream";

/**
 * Timeout in milliseconds for upstream API requests in the rehearsal server.
 */
export const REHEARSAL_UPSTREAM_TIMEOUT_MS: number;

/**
 * Options for creating the production-shaped rehearsal request handler.
 */
export interface RehearsalRequestHandlerOptions {
  dist?: string;
  apiPort?: number;
  upstreamTimeoutMs?: number;
  statPath?: (path: string) => Promise<{ isFile(): boolean }>;
  openFile?: (path: string) => Readable;
  report?: (message: string, error: unknown) => void;
}

/**
 * Creates a handler that serves the built app and proxies API requests.
 */
export function createRehearsalRequestHandler(options?: RehearsalRequestHandlerOptions): RequestListener;
