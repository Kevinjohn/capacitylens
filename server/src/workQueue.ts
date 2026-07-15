export class WorkQueueFullError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WorkQueueFullError'
  }
}

type WaitingWork = {
  work: () => Promise<unknown>
  resolve: (value: unknown) => void
  reject: (reason?: unknown) => void
}

/** A small fail-closed in-process concurrency/queue bound for memory-expensive operations. */
export class BoundedWorkQueue {
  private active = 0
  private readonly waiting: WaitingWork[] = []

  constructor(
    readonly maxActive: number,
    readonly maxQueued: number,
    private readonly fullMessage: string,
  ) {
    if (!Number.isSafeInteger(maxActive) || maxActive < 1) throw new RangeError('maxActive must be positive.')
    if (!Number.isSafeInteger(maxQueued) || maxQueued < 0) throw new RangeError('maxQueued must be non-negative.')
  }

  run<T>(work: () => Promise<T>): Promise<T> {
    if (this.active < this.maxActive) {
      this.active += 1
      return this.execute(work)
    }
    if (this.waiting.length >= this.maxQueued) {
      return Promise.reject(new WorkQueueFullError(this.fullMessage))
    }
    return new Promise<T>((resolve, reject) => {
      this.waiting.push({
        work,
        resolve: (value) => resolve(value as T),
        reject,
      })
    })
  }

  private async execute<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work()
    } finally {
      const next = this.waiting.shift()
      if (next) void this.execute(next.work).then(next.resolve, next.reject)
      else this.active -= 1
    }
  }
}
