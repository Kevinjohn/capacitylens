/** The failure a planning transport throws when the cache must act on it; see `PlanningTransport`. */
export class PlanningCacheError extends Error {
  readonly code: string | undefined;
  readonly status: number | undefined;
  readonly uncertain: boolean;
  readonly restorableItemCount: number | undefined;

  constructor(
    message: string,
    code?: string,
    status?: number,
    uncertain = false,
    restorableItemCount?: number,
  ) {
    super(message);
    this.name = 'PlanningCacheError';
    this.code = code;
    this.status = status;
    this.uncertain = uncertain;
    this.restorableItemCount = restorableItemCount;
  }
}

/** Reads the code, status and message of any thrown planning failure. */
export function getErrorDetails(error: unknown): {
  code?: string;
  status?: number;
  message: string;
} {
  if (error !== null && typeof error === 'object') {
    const candidate = error as {
      code?: unknown;
      status?: unknown;
      statusCode?: unknown;
      message?: unknown;
    };
    return {
      ...(typeof candidate.code === 'string' ? { code: candidate.code } : {}),
      ...(typeof candidate.status === 'number'
        ? { status: candidate.status }
        : typeof candidate.statusCode === 'number'
          ? { status: candidate.statusCode }
          : {}),
      message:
        typeof candidate.message === 'string' ? candidate.message : 'Planning request failed.',
    };
  }
  return { message: error instanceof Error ? error.message : 'Planning request failed.' };
}
