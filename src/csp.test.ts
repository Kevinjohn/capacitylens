import { describe, expect, it } from 'vitest'
import nginx from '../nginx.conf?raw'

describe('SPA content security policy', () => {
  it('keeps packaged nginx compatible with inline scheduler geometry and same-origin APIs', () => {
    expect(nginx).toContain("script-src 'self'")
    expect(nginx).toContain("style-src 'self'; style-src-attr 'unsafe-inline'")
    expect(nginx).toContain("connect-src 'self'")
    expect(nginx).toContain('report-uri /api/security/csp-report')
    expect(nginx).toContain('report-to csp-endpoint')
    expect(nginx).toContain('Reporting-Endpoints')
    expect(nginx).not.toContain("connect-src 'self' https:")
    expect(nginx).toContain('Cross-Origin-Embedder-Policy "require-corp"')
    expect(nginx).toContain('Cross-Origin-Opener-Policy "same-origin"')
    expect(nginx).toContain('Cross-Origin-Resource-Policy "same-origin"')
  })

  it('verifies the internal API certificate and has no plaintext proxy fallback', () => {
    expect(nginx).toContain('proxy_ssl_verify on')
    expect(nginx).toContain('proxy_ssl_name api')
    expect(nginx).toContain('proxy_ssl_protocols TLSv1.2 TLSv1.3')
    expect(nginx).toContain('proxy_pass https://api:8787')
    expect(nginx).not.toContain('proxy_pass http://api:8787')
  })
})
