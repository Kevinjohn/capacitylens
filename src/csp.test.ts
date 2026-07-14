import { describe, expect, it } from 'vitest'
import html from '../index.html?raw'
import nginx from '../nginx.conf?raw'

describe('SPA content security policy', () => {
  it('allows required inline layout styles while keeping connections same-origin', () => {
    const meta = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)?.[1] ?? ''
    expect(meta).toContain("script-src 'self'")
    expect(meta).toContain("style-src 'self' 'unsafe-inline'")
    expect(meta).toContain("connect-src 'self'")
    expect(meta).not.toContain("connect-src 'self' https:")
  })

  it('keeps packaged nginx compatible with inline scheduler geometry and same-origin APIs', () => {
    expect(nginx).toContain("style-src 'self' 'unsafe-inline'")
    expect(nginx).toContain("connect-src 'self'")
    expect(nginx).not.toContain("connect-src 'self' https:")
  })
})
