/** Shared authentication API/Vite memory reserved before worker admission. */
export const AUTH_SERVER_MEMORY_BYTES: number;
/** Measured full-stack memory per browser worker, in bytes. */
export const WORKER_MEMORY_BYTES: number;
/** Read memory available for isolated browser workers. */
export function availableMemoryBytes(): number;
/** Select a nonzero memory-, CPU- and port-bounded worker count, or refuse before startup. */
export function browserWorkerCount(
  environment?: Readonly<Record<string, string | undefined>>,
  memory?: { freeBytes?: number; workerBytes?: number; reservedBytes?: number },
): number;

/** Publish coordinator memory admission for inherited worker configuration reloads. */
export function configurationWorkerCount(
  environment?: Record<string, string | undefined>,
  memory?: { freeBytes?: number; workerBytes?: number; reservedBytes?: number },
): number;
