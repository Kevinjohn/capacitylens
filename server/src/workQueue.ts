export class WorkQueueFullError extends Error {
  constructor(
    message: string,
    readonly reason: "full" | "wait_timeout" = "full",
  ) {
    super(message);
    this.name = "WorkQueueFullError";
  }
}

type WaitingWork = {
  work: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
  signal?: AbortSignal;
  abort?: () => void;
  waitTimer?: ReturnType<typeof setTimeout>;
};

export interface WorkQueueOptions {
  /** Maximum time work may remain queued before it is shed. Omit for no queue deadline. */
  maxWaitMs?: number;
  /** Operational signal for capacity shedding; called exactly once per full/expired rejection. */
  onSaturated?: (reason: WorkQueueFullError["reason"]) => void;
}

function abortReason(signal: AbortSignal): unknown {
  return (
    signal.reason ??
    new DOMException("The queued work was cancelled.", "AbortError")
  );
}

/**
 * A small fail-closed in-process concurrency/queue bound for memory-expensive operations.
 *
 * Work must always settle by itself (for example, network work must have its own abort deadline).
 * This queue deliberately does not evict active work: releasing a slot while the underlying work
 * is still running would exceed `maxActive` and defeat the resource bound it exists to enforce.
 */
export class BoundedWorkQueue {
  private active = 0;
  private readonly waiting: WaitingWork[] = [];

  constructor(
    readonly maxActive: number,
    readonly maxQueued: number,
    private readonly fullMessage: string,
    private readonly options: WorkQueueOptions = {},
  ) {
    if (!Number.isSafeInteger(maxActive) || maxActive < 1)
      throw new RangeError("maxActive must be positive.");
    if (!Number.isSafeInteger(maxQueued) || maxQueued < 0)
      throw new RangeError("maxQueued must be non-negative.");
    if (
      options.maxWaitMs !== undefined &&
      (!Number.isSafeInteger(options.maxWaitMs) || options.maxWaitMs < 1)
    )
      throw new RangeError("maxWaitMs must be a positive safe integer.");
  }

  private saturated(reason: WorkQueueFullError["reason"]): WorkQueueFullError {
    this.options.onSaturated?.(reason);
    return new WorkQueueFullError(this.fullMessage, reason);
  }

  run<T>(work: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) return Promise.reject(abortReason(signal));
    if (this.active < this.maxActive) {
      this.active += 1;
      return this.execute(work);
    }
    if (this.waiting.length >= this.maxQueued) {
      return Promise.reject(this.saturated("full"));
    }
    return new Promise<T>((resolve, reject) => {
      const waiting: WaitingWork = {
        work,
        resolve: (value) => resolve(value as T),
        reject,
        signal,
      };
      if (signal) {
        waiting.abort = () => {
          const index = this.waiting.indexOf(waiting);
          if (index < 0) return;
          this.waiting.splice(index, 1);
          if (waiting.waitTimer) clearTimeout(waiting.waitTimer);
          reject(abortReason(signal));
        };
        signal.addEventListener("abort", waiting.abort, { once: true });
      }
      if (this.options.maxWaitMs !== undefined) {
        waiting.waitTimer = setTimeout(() => {
          const index = this.waiting.indexOf(waiting);
          if (index < 0) return;
          this.waiting.splice(index, 1);
          if (waiting.signal && waiting.abort)
            waiting.signal.removeEventListener("abort", waiting.abort);
          reject(this.saturated("wait_timeout"));
        }, this.options.maxWaitMs);
        waiting.waitTimer.unref?.();
      }
      this.waiting.push(waiting);
    });
  }

  private async execute<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } finally {
      const next = this.waiting.shift();
      if (next) {
        if (next.waitTimer) clearTimeout(next.waitTimer);
        if (next.signal && next.abort)
          next.signal.removeEventListener("abort", next.abort);
        void this.execute(next.work).then(next.resolve, next.reject);
      } else this.active -= 1;
    }
  }
}
