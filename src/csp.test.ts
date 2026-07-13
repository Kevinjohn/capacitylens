import { describe, expect, it } from 'vitest'
import html from '../index.html?raw'
import nginx from '../nginx.conf?raw'

describe('SPA content security policy', () => {
  it('allows required inline layout styles without statically blocking a configured API origin', () => {
    const meta = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)?.[1] ?? ''
    expect(meta).toContain("script-src 'self'")
    expect(meta).toContain("style-src 'self' 'unsafe-inline'")
    // The meta policy MUST carry a connect-src that permits the configurable cross-origin API
    // (VITE_CAPACITYLENS_API): a response-header CSP can only narrow a meta policy, never widen it,
    // so omitting connect-src here would fall back to default-src 'self' and statically block a
    // cross-origin API even when nginx allows it. Mirror the packaged nginx policy.
    expect(meta).toContain("connect-src 'self' https: http:")
  })

  it('keeps packaged nginx compatible with inline scheduler geometry and external HTTP APIs', () => {
    expect(nginx).toContain("style-src 'self' 'unsafe-inline'")
    expect(nginx).toContain("connect-src 'self' https: http:")
  })
})
