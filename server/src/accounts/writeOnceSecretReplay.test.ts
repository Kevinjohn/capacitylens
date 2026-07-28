import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  WRITE_ONCE_SECRET_REPLAY_WINDOW_MS,
  WriteOnceSecretReplay,
} from './writeOnceSecretReplay'

describe('WriteOnceSecretReplay', () => {
  afterEach(() => vi.useRealTimers())

  it('evicts an idle bearer on its timer and clears timers when a value is removed early', () => {
    vi.useFakeTimers()
    vi.setSystemTime('2026-01-01T00:00:00.000Z')
    const replay = new WriteOnceSecretReplay<{ token: string }>(2)

    expect(replay.reserve('claimed')).toEqual({ accepted: true })
    replay.storeReserved('claimed', { token: 'claimed-secret' })
    expect(vi.getTimerCount()).toBe(1)
    replay.deleteWhere((value) => value.token === 'claimed-secret')
    expect(vi.getTimerCount()).toBe(0)

    expect(replay.reserve('idle')).toEqual({ accepted: true })
    replay.storeReserved('idle', { token: 'idle-secret' })
    expect(vi.getTimerCount()).toBe(1)
    vi.advanceTimersByTime(WRITE_ONCE_SECRET_REPLAY_WINDOW_MS)
    expect(vi.getTimerCount()).toBe(0)
    expect(replay.get('idle')).toBeUndefined()
  })

  it('refuses overflow without evicting a completed response', () => {
    vi.useFakeTimers()
    vi.setSystemTime('2026-01-01T00:00:00.000Z')
    const replay = new WriteOnceSecretReplay<string>(2)

    expect(replay.reserve('first')).toEqual({ accepted: true })
    replay.storeReserved('first', 'secret-1')
    expect(replay.reserve('second')).toEqual({ accepted: true })
    replay.storeReserved('second', 'secret-2')

    expect(replay.reserve('third')).toEqual({
      accepted: false,
      retryAfterMs: WRITE_ONCE_SECRET_REPLAY_WINDOW_MS,
    })
    expect(replay.get('first')).toBe('secret-1')
    expect(replay.get('second')).toBe('secret-2')
    expect(vi.getTimerCount()).toBe(2)
  })

  it('releases an unused reservation and never lets it delete a stored response', () => {
    const replay = new WriteOnceSecretReplay<string>(1)

    expect(replay.reserve('failed')).toEqual({ accepted: true })
    expect(replay.reserve('blocked')).toEqual({ accepted: false, retryAfterMs: 1_000 })
    replay.releaseReservation('failed')
    expect(replay.reserve('completed')).toEqual({ accepted: true })
    replay.storeReserved('completed', 'secret')

    replay.releaseReservation('completed')
    expect(replay.get('completed')).toBe('secret')
  })

  it('rejects storing a response that did not reserve capacity', () => {
    const replay = new WriteOnceSecretReplay<string>(1)
    expect(() => replay.storeReserved('missing', 'secret'))
      .toThrow('without reserved replay capacity')
  })
})
