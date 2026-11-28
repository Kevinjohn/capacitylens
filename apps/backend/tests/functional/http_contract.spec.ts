import { test } from '@japa/runner'
import { resetState } from '#tests/helpers/state_fixture'
import { freshDatabase } from '#tests/helpers/fresh_database'
import { clearIdentities } from '#tests/helpers/identities'
import { configureAuth, session, loginAsMember } from '#tests/helpers/planning/functional_helpers'
import { limitedRead, withServer } from '#tests/helpers/data/raw_http'

// Proxy trust, HSTS and cookie security are read once at boot, so each case starts its own server.
test.group('HTTP proxy, transport and cookie contract', (group) => {
  group.each.timeout(90_000)

  test('untrusted proxy headers: the limiter keys a loopback request by its socket', async ({
    assert,
  }) => {
    await withServer(
      { CAPACITYLENS_TRUST_PROXY_HEADERS: 'false', CAPACITYLENS_RATE_LIMIT: '1' },
      {},
      async (server) => {
        assert.notEqual(await limitedRead(server, '203.0.113.5'), 429)
        assert.equal(
          await limitedRead(server, '198.51.100.99'),
          429,
          'a different forwarded address from the same socket shares one budget'
        )
      }
    )
  })

  test('trusted proxy headers: the limiter keys a loopback request by the nearest untrusted hop', async ({
    assert,
  }) => {
    await withServer(
      { CAPACITYLENS_TRUST_PROXY_HEADERS: 'true', CAPACITYLENS_RATE_LIMIT: '1' },
      {},
      async (server) => {
        assert.notEqual(await limitedRead(server, '198.51.100.7, 203.0.113.5'), 429)
        assert.equal(
          await limitedRead(server, '203.0.113.5'),
          429,
          'the chain was keyed by 203.0.113.5'
        )
        assert.notEqual(
          await limitedRead(server, '198.51.100.7'),
          429,
          'the leftmost, client-supplied entry is not the key'
        )
      }
    )
  })

  test('trusted proxy headers: a non-loopback peer cannot supply a forwarded address', async ({
    assert,
  }) => {
    await withServer(
      { CAPACITYLENS_TRUST_PROXY_HEADERS: 'true', CAPACITYLENS_RATE_LIMIT: '1' },
      { peer: '10.0.0.9' },
      async (server) => {
        assert.notEqual(await limitedRead(server, '203.0.113.5'), 429)
        assert.equal(
          await limitedRead(server, '198.51.100.7'),
          429,
          'both requests are keyed by the peer 10.0.0.9'
        )
      }
    )
  })

  test('private proxy trust: a private-network peer supplies the forwarded address', async ({
    assert,
  }) => {
    await withServer(
      { CAPACITYLENS_TRUST_PROXY_HEADERS: 'private', CAPACITYLENS_RATE_LIMIT: '1' },
      { peer: '172.18.0.3' },
      async (server) => {
        assert.notEqual(await limitedRead(server, '203.0.113.5'), 429)
        assert.equal(await limitedRead(server, '203.0.113.5'), 429, 'the same client is limited')
        assert.notEqual(
          await limitedRead(server, '198.51.100.7'),
          429,
          'another forwarded client has its own budget'
        )
      }
    )
  })

  test('private proxy trust: a public peer cannot supply a forwarded address', async ({
    assert,
  }) => {
    await withServer(
      { CAPACITYLENS_TRUST_PROXY_HEADERS: 'private', CAPACITYLENS_RATE_LIMIT: '1' },
      { peer: '203.0.113.50' },
      async (server) => {
        assert.notEqual(await limitedRead(server, '203.0.113.5'), 429)
        assert.equal(
          await limitedRead(server, '198.51.100.7'),
          429,
          'both requests are keyed by the peer 203.0.113.50'
        )
      }
    )
  })

  test('an https public URL sends host-only HSTS for one year', async ({ assert }) => {
    await withServer(
      { CAPACITYLENS_PUBLIC_URL: 'https://capacity.example.test' },
      {},
      async (server) => {
        const reply = await server.send('GET', '/health/live')
        assert.equal(reply.status, 200)
        assert.strictEqual(reply.headers['strict-transport-security'], 'max-age=31536000')
      }
    )
  })

  test('an http public URL sends no HSTS', async ({ assert }) => {
    await withServer({ CAPACITYLENS_PUBLIC_URL: 'http://127.0.0.1' }, {}, async (server) => {
      const reply = await server.send('GET', '/health/live')
      assert.equal(reply.status, 200)
      assert.notProperty(reply.headers, 'strict-transport-security')
    })
  })

  test('an unset public origin falls back to the framework URL', async ({ assert }) => {
    await withServer({ CAPACITYLENS_PUBLIC_URL: '' }, {}, async (server) => {
      const response = await server.send('GET', '/health/live')
      assert.equal(response.status, 200)
      assert.isUndefined(response.headers['strict-transport-security'])
    })
  })

  test('a refused fallback origin names the variable it came from', async ({ assert }) => {
    await assert.rejects(
      () =>
        withServer(
          { CAPACITYLENS_PUBLIC_URL: '', APP_URL: 'https://capacity.example.test/' },
          {},
          async () => {}
        ),
      /APP_URL must be a bare HTTP\(S\) origin/
    )
  })

  test('production refuses an http public URL before serving', async ({ assert }) => {
    // Account links carry bearer tokens, so the Account Kit requires an HTTPS origin in production.
    await assert.rejects(
      () =>
        withServer(
          {
            NODE_ENV: 'production',
            CAPACITYLENS_PUBLIC_URL: 'http://127.0.0.1',
          },
          {},
          async () => {}
        ),
      /CAPACITYLENS_PUBLIC_URL: public production origins require HTTPS/
    )
  })

  test('security headers reach a static file and an unmatched route', async ({ assert }) => {
    await withServer(
      { CAPACITYLENS_PUBLIC_URL: 'https://capacity.example.test' },
      {},
      async (server) => {
        const staticFile = await server.send('GET', '/favicon.svg')
        assert.equal(staticFile.status, 200)
        assert.match(String(staticFile.headers['content-type']), /^image\/svg\+xml/)
        const unmatched = await server.send('PATCH', '/no-such-route', {
          'sec-fetch-site': 'same-origin',
        })
        assert.equal(unmatched.status, 404)
        for (const [label, reply] of [
          ['static', staticFile],
          ['unmatched', unmatched],
        ] as const) {
          assert.strictEqual(
            reply.headers['strict-transport-security'],
            'max-age=31536000',
            `${label} HSTS`
          )
          assert.equal(reply.headers['x-frame-options'], 'DENY', `${label} frame options`)
          assert.equal(reply.headers['x-content-type-options'], 'nosniff', `${label} sniffing`)
          assert.equal(reply.headers['referrer-policy'], 'no-referrer', `${label} referrer`)
          assert.match(
            String(reply.headers['content-security-policy']),
            /frame-ancestors 'none'/,
            `${label} CSP`
          )
        }
      }
    )
  })
})

test.group('HTTP response envelope', (group) => {
  group.setup(() => freshDatabase())
  group.each.setup(async () => {
    await clearIdentities()
    await resetState('single')
  })

  test('a success answer is wrapped in data and a refusal is not', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup)
    const { cookie } = await loginAsMember('owner')
    const signedIn = await session(client.visit('api.companies.index'), cookie).send()
    signedIn.assertStatus(200)
    const body = signedIn.body() as Record<string, unknown>
    assert.deepEqual(Object.keys(body), ['data'])
    assert.isArray(body.data)
    assert.lengthOf(body.data as unknown[], 1)

    const signedOut = await client
      .visit('api.companies.index')
      .header('sec-fetch-site', 'same-origin')
    signedOut.assertStatus(401)
    assert.deepEqual(signedOut.body(), { error: 'Sign-in required.', code: 'E_SIGN_IN_REQUIRED' })
  })
})
