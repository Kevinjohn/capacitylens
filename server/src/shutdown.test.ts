import { describe, it, expect, vi } from 'vitest'
import { createLastResortErrorHandler, createShutdownHandler } from './shutdown'

// P1.2: the shutdown path must drain Fastify BEFORE closing the DB (a request still
// in flight after db.close() would die mid-transaction — the exact bug this fixes),
// and a second signal must force-exit rather than wait on a stuck drain.

describe('createShutdownHandler', () => {
  it('closes the app (drain) before the db, then exits 0', async () => {
    const order: string[] = []
    const handler = createShutdownHandler(
      { close: async () => void order.push('app.close') },
      { close: () => void order.push('db.close') },
      (code) => void order.push(`exit ${code}`),
    )
    await handler()
    expect(order).toEqual(['app.close', 'db.close', 'exit 0'])
  })

  it('a second signal while draining force-exits 1 without touching the db', async () => {
    let releaseDrain!: () => void
    const drain = new Promise<void>((resolve) => (releaseDrain = resolve))
    const order: string[] = []
    const handler = createShutdownHandler(
      { close: () => drain.then(() => void order.push('app.close')) },
      { close: () => void order.push('db.close') },
      (code) => void order.push(`exit ${code}`),
    )
    const first = handler()
    await handler() // second signal arrives mid-drain
    expect(order).toEqual(['exit 1']) // forced out; db.close must not have run yet
    releaseDrain()
    await first // (a real exit(1) would have terminated; the fake lets the drain finish)
    expect(order).toEqual(['exit 1', 'app.close', 'db.close', 'exit 0'])
  })

  it('exits 1 when the drain itself throws', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const codes: number[] = []
    const handler = createShutdownHandler(
      { close: () => Promise.reject(new Error('boom')) },
      { close: () => {} },
      (code) => void codes.push(code),
    )
    await handler()
    expect(codes).toEqual([1])
    expect(error).toHaveBeenCalled()
    error.mockRestore()
  })

  it('preserves a non-zero exit code after an orderly fatal drain', async () => {
    const order: string[] = []
    const handler = createShutdownHandler(
      { close: async () => void order.push('app.close') },
      { close: () => void order.push('db.close') },
      (code) => void order.push(`exit ${code}`),
    )
    await handler(1)
    expect(order).toEqual(['app.close', 'db.close', 'exit 1'])
  })
})

describe('createLastResortErrorHandler', () => {
  it('logs details locally, emits only a classified security event and drains with failure', async () => {
    const shutdown = vi.fn(async () => {})
    const securityLog = vi.fn()
    const logError = vi.fn()
    const handler = createLastResortErrorHandler(shutdown, securityLog, logError)
    const error = new Error('sensitive implementation detail')

    await handler('uncaught_exception', error)

    expect(logError).toHaveBeenCalledWith('capacitylens-server: last-resort uncaught_exception', error)
    expect(securityLog).toHaveBeenCalledWith({
      event: 'process_failure',
      outcome: 'failure',
      kind: 'uncaught_exception',
    })
    expect(JSON.stringify(securityLog.mock.calls)).not.toContain(error.message)
    expect(shutdown).toHaveBeenCalledWith(1)
  })

  it('still drains if security forwarding fails and normalizes a non-Error rejection', async () => {
    const shutdown = vi.fn(async () => {})
    const securityLog = vi.fn(() => {
      throw new Error('collector unavailable')
    })
    const logError = vi.fn()
    const handler = createLastResortErrorHandler(shutdown, securityLog, logError)

    await handler('unhandled_rejection', 'rejected value')

    expect(logError.mock.calls[0]?.[1]).toMatchObject({ message: 'Non-Error rejection: rejected value' })
    expect(shutdown).toHaveBeenCalledWith(1)
  })
})
