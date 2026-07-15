import { describe, expect, it, vi } from 'vitest'
import { InternalTlsConfigError, loadInternalTls } from './internalTls'

describe('loadInternalTls', () => {
  it('keeps local development on HTTP when both paths are omitted', () => {
    const read = vi.fn<(path: string) => Buffer>()
    expect(loadInternalTls({}, read)).toBeUndefined()
    expect(read).not.toHaveBeenCalled()
  })

  it.each([
    [{ CAPACITYLENS_INTERNAL_TLS_CERT: '/tls/api.crt' }],
    [{ CAPACITYLENS_INTERNAL_TLS_KEY: '/tls/api.key' }],
    [{ CAPACITYLENS_INTERNAL_TLS_CERT: '  ', CAPACITYLENS_INTERNAL_TLS_KEY: '/tls/api.key' }],
  ])('fails closed when only one non-empty path is configured', (env) => {
    expect(() => loadInternalTls(env)).toThrow(InternalTlsConfigError)
  })

  it('loads both files and pins the minimum protocol to TLS 1.2', () => {
    const read = vi.fn((path: string) => Buffer.from(path.endsWith('.crt') ? 'certificate' : 'key'))
    expect(
      loadInternalTls(
        {
          CAPACITYLENS_INTERNAL_TLS_CERT: '/tls/api.crt',
          CAPACITYLENS_INTERNAL_TLS_KEY: '/tls/api.key',
        },
        read,
      ),
    ).toEqual({
      cert: Buffer.from('certificate'),
      key: Buffer.from('key'),
      minVersion: 'TLSv1.2',
    })
    expect(read.mock.calls).toEqual([['/tls/api.crt'], ['/tls/api.key']])
  })

  it('frames unreadable and empty identities as configuration errors', () => {
    expect(() =>
      loadInternalTls(
        {
          CAPACITYLENS_INTERNAL_TLS_CERT: '/tls/api.crt',
          CAPACITYLENS_INTERNAL_TLS_KEY: '/tls/api.key',
        },
        () => {
          throw new Error('permission denied')
        },
      ),
    ).toThrow(/Unable to read.*permission denied/)

    expect(() =>
      loadInternalTls(
        {
          CAPACITYLENS_INTERNAL_TLS_CERT: '/tls/api.crt',
          CAPACITYLENS_INTERNAL_TLS_KEY: '/tls/api.key',
        },
        () => Buffer.alloc(0),
      ),
    ).toThrow(/must not be empty/)
  })
})
