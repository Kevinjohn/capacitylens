import { AsyncLocalStorage } from 'node:async_hooks'

export class PasswordWorkQueueFullError extends Error {}

export class PasswordWorkQueue {
  private active = 0
  private readonly waiting: Array<{
    run: () => Promise<unknown>
    resolve: (value: unknown) => void
    reject: (error: unknown) => void
    signal?: AbortSignal
    abort?: () => void
    timer?: NodeJS.Timeout
  }> = []

  constructor(
    private readonly maxActive: number,
    private readonly maxQueued: number,
    private readonly maxWaitMs: number
  ) {}

  run<T>(work: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) return Promise.reject(new PasswordWorkQueueFullError())
    if (this.active < this.maxActive) return this.start(work)
    if (this.waiting.length >= this.maxQueued) {
      return Promise.reject(new PasswordWorkQueueFullError())
    }

    return new Promise<T>((resolve, reject) => {
      const entry = {
        run: work,
        resolve: resolve as (value: unknown) => void,
        reject,
        signal,
        abort: undefined as (() => void) | undefined,
        timer: undefined as NodeJS.Timeout | undefined,
      }
      const remove = (error: Error) => {
        const index = this.waiting.indexOf(entry)
        if (index === -1) return
        this.waiting.splice(index, 1)
        if (entry.timer) clearTimeout(entry.timer)
        signal?.removeEventListener('abort', entry.abort!)
        reject(error)
      }
      if (signal) {
        entry.abort = () => remove(new PasswordWorkQueueFullError())
        signal.addEventListener('abort', entry.abort, { once: true })
      }
      entry.timer = setTimeout(() => remove(new PasswordWorkQueueFullError()), this.maxWaitMs)
      this.waiting.push(entry)
    })
  }

  private start<T>(work: () => Promise<T>): Promise<T> {
    this.active += 1
    return work().finally(() => {
      this.active -= 1
      this.startWaiting()
    })
  }

  private startWaiting(): void {
    while (this.active < this.maxActive && this.waiting.length > 0) {
      const entry = this.waiting.shift()!
      if (entry.timer) clearTimeout(entry.timer)
      entry.signal?.removeEventListener('abort', entry.abort!)
      void this.start(entry.run).then(entry.resolve, entry.reject)
    }
  }
}

const requestAbortSignal = new AsyncLocalStorage<AbortSignal>()

/** Runs password work with the request's cancellation signal for queued work. */
export function runWithPasswordAbortSignal<T>(
  signal: AbortSignal,
  work: () => Promise<T>
): Promise<T> {
  return requestAbortSignal.run(signal, work)
}

export function currentPasswordAbortSignal(): AbortSignal | undefined {
  return requestAbortSignal.getStore()
}
