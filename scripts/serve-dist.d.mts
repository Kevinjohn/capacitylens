import type { RequestListener } from "node:http";
import type { Readable } from "node:stream";

export const REHEARSAL_UPSTREAM_TIMEOUT_MS: number;

export interface RehearsalRequestHandlerOptions {
  dist?: string;
  apiPort?: number;
  upstreamTimeoutMs?: number;
  statPath?: (path: string) => Promise<{ isFile(): boolean }>;
  openFile?: (path: string) => Readable;
  report?: (message: string, error: unknown) => void;
}

export function createRehearsalRequestHandler(options?: RehearsalRequestHandlerOptions): RequestListener;
