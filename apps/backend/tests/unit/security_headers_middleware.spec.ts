import { test } from '@japa/runner';
import SecurityHeadersMiddleware from '#middleware/security_headers_middleware';

const strictPolicy =
  "default-src 'self'; script-src 'self'; style-src 'self'; style-src-attr 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'none'; form-action 'self'";
async function policyFor(url: string, body: unknown) {
  const headers = new Map<string, string>();
  const ctx = {
    request: {
      url: () => url,
      method: () => 'GET',
      header: () => undefined,
    },
    response: {
      header(name: string, value: string) {
        headers.set(name.toLowerCase(), value);
      },
      getHeader(name: string) {
        return headers.get(name.toLowerCase());
      },
      getBody() {
        return body;
      },
      type(value: string) {
        headers.set('content-type', value);
      },
      forbidden() {
        throw new Error('unexpected refusal');
      },
    },
  };
  await new SecurityHeadersMiddleware().handle(ctx as never, async () => {});
  return headers.get('content-security-policy');
}

test('uses one CSP policy for API and application responses', async ({ assert }) => {
  assert.equal(await policyFor('/api/health', { ok: true }), strictPolicy);
  assert.equal(await policyFor('/api/failure', '<html>failure</html>'), strictPolicy);
  assert.equal(await policyFor('/api/failure', Buffer.from('failure')), strictPolicy);
  assert.equal(await policyFor('/schedule', '<html>app</html>'), strictPolicy);
});
