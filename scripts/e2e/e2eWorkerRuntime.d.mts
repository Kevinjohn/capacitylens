export interface E2eWorkerTarget {
  portLane: number;
  slot: number;
  api: string;
  databasePath: string;
  templatePath: string;
}

export interface E2eWorkerServer {
  target: E2eWorkerTarget;
  baseURL: string;
  stop(): Promise<void>;
}

export function startE2eWorkerServer(
  target: E2eWorkerTarget,
  portLane?: number,
  slot?: number,
): Promise<E2eWorkerServer>;
export function recoverE2eWorker(
  target: E2eWorkerTarget,
  portLane?: number,
  slot?: number,
): Promise<void>;

/** Complete lease metadata published before worker processes start. */
export interface E2eWorkerLease {
  paths: { lock: string; owner: string };
  recovered: boolean;
}
/** Exclusively claim a worker slot, safely recovering dead owners. */
export function acquireE2eWorkerLease(portLane: number, slot: number): Promise<E2eWorkerLease>;
/** Release only this lease's owner record. */
export function releaseE2eWorkerLease(paths: E2eWorkerLease['paths']): Promise<void>;
