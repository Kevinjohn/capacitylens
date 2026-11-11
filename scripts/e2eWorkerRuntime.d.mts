export interface E2eWorkerTarget {
  lane: number;
  slot: number;
  api: string;
  web: string;
  databasePath: string;
  templatePath: string;
}

export interface E2eWorkerServer {
  target: E2eWorkerTarget;
  baseURL: string;
  controlToken: string;
  stop(): Promise<void>;
}

export function startE2eWorkerServer(
  target: E2eWorkerTarget,
  lane?: number,
  slot?: number,
): Promise<E2eWorkerServer>;
export function recoverE2eWorker(
  target: E2eWorkerTarget,
  lane?: number,
  slot?: number,
): Promise<void>;

/** Complete lease metadata published before worker processes start. */
export interface E2eWorkerLease {
  paths: { lock: string; owner: string };
  recovered: boolean;
}
/** Exclusively claim a worker slot, safely recovering dead owners. */
export function acquireE2eWorkerLease(lane: number, slot: number): Promise<E2eWorkerLease>;
/** Release only this lease's owner record. */
export function releaseE2eWorkerLease(paths: E2eWorkerLease['paths']): Promise<void>;

/** Refuse a reset while the worker Vite has requests or upstream sockets open. */
export function assertE2eProxyDrained(webOrigin: string): Promise<void>;
/** Refuse a reset while the disposable API has handlers still completing. */
export function assertE2eRequestsDrained(apiOrigin: string): Promise<void>;
