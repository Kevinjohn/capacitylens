import { afterEach, describe, expect, it, vi } from 'vitest'
import { signOutAndReload } from './signOut'

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('signOutAndReload', () => {
  it('continues to the server request and reload when offline cleanup never settles', async () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const clearAccountCommands = vi.fn()
    const disableOfflineRead = vi.fn().mockResolvedValue(undefined)
    const requestSignOut = vi.fn().mockResolvedValue({ ok: true, status: 200 })
    const reload = vi.fn()

    const completion = signOutAndReload({
      clearAccountCommands,
      clearOfflineData: () => new Promise<void>(() => {}),
      disableOfflineRead,
      requestSignOut,
      reload,
      cleanupTimeoutMs: 50,
    })

    expect(clearAccountCommands).toHaveBeenCalledOnce()
    expect(requestSignOut).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(50)
    await completion

    expect(disableOfflineRead).toHaveBeenCalledOnce()
    expect(requestSignOut).toHaveBeenCalledOnce()
    expect(reload).toHaveBeenCalledOnce()
  })
})
