import { test } from '@japa/runner'
import SecurityHeadersMiddleware from '#middleware/security_headers_middleware'
import { isTrustedUnsafeOrigin } from '#services/cors_policy'

const strictPolicy =
  "default-src 'self'; script-src 'self'; style-src 'self'; style-src-attr 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'none'; form-action 'self'"
async function policyFor(url: string, body: unknown) {
  const headers = new Map<string, string>()
  const ctx = {
    request: {
      url: () => url,
      method: () => 'GET',
      header: () => undefined,
    },
    response: {
      header(name: string, value: string) {
        headers.set(name.toLowerCase(), value)
      },
      getHeader(name: string) {
        return headers.get(name.toLowerCase())
      },
      getBody() {
        return body
      },
      type(value: string) {
        headers.set('content-type', value)
      },
      forbidden() {
        throw new Error('unexpected refusal')
      },
    },
  }
  await new SecurityHeadersMiddleware().handle(ctx as never, async () => {})
  return headers.get('content-security-policy')
}

test('uses one CSP policy for API and application responses', async ({ assert }) => {
  assert.equal(await policyFor('/api/health', { ok: true }), strictPolicy)
  assert.equal(await policyFor('/api/failure', '<html>failure</html>'), strictPolicy)
  assert.equal(await policyFor('/api/failure', Buffer.from('failure')), strictPolicy)
  assert.equal(await policyFor('/schedule', '<html>app</html>'), strictPolicy)
})

test('trusts explicit CORS and same-origin proxy writes while rejecting sibling origins', ({
  assert,
}) => {
  assert.isTrue(
    isTrustedUnsafeOrigin({
      origin: 'http://localhost:5173',
      fetchSite: 'cross-site',
    })
  )
  assert.isTrue(
    isTrustedUnsafeOrigin({
      origin: 'https://capacity.example.com',
      host: 'capacity.example.com',
      protocol: 'https',
    })
  )
  assert.isTrue(
    isTrustedUnsafeOrigin({
      origin: 'https://capacity.example.com',
      host: 'capacity.example.com',
      protocol: 'http',
    })
  )
  assert.isTrue(
    isTrustedUnsafeOrigin({
      origin: 'http://capacity.example.com',
      host: 'capacity.example.com',
      protocol: 'http',
    })
  )
  assert.isTrue(
    isTrustedUnsafeOrigin({
      origin: 'http://capacity.example.com',
      host: 'CAPACITY.EXAMPLE.COM:80',
      protocol: 'http',
    })
  )
  assert.isTrue(
    isTrustedUnsafeOrigin({
      origin: 'https://capacity.example.com',
      fetchSite: 'same-origin',
    })
  )
  assert.isFalse(
    isTrustedUnsafeOrigin({
      origin: 'https://sibling.example.com',
      fetchSite: 'same-site',
    })
  )
  assert.isFalse(isTrustedUnsafeOrigin({ fetchSite: 'cross-site' }))
  for (const host of ['exa mple.com', '[', 'capacity.example.com:8443:9000'])
    assert.isFalse(
      isTrustedUnsafeOrigin({
        origin: 'https://capacity.example.com',
        host,
        protocol: 'http',
      })
    )
  assert.isFalse(
    isTrustedUnsafeOrigin({
      origin: 'http://capacity.example.com',
      host: 'capacity.example.com',
      protocol: 'https',
    })
  )
  assert.isFalse(
    isTrustedUnsafeOrigin({
      origin: 'https://other.example.com',
      host: 'capacity.example.com',
      protocol: 'http',
    })
  )
})
