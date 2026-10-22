import { test } from '@japa/runner'
import type { ApiClient } from '@japa/api-client'
import {
  authenticatedDataClient,
  resetAuthenticatedData,
} from '../helpers/authenticated_data_fixture.js'
import { freshDatabase } from '../helpers/fresh_database.js'
import { request as httpRequest } from 'node:http'

interface RawResponse {
  statusCode: number | undefined
  body: string
}

function postRaw(
  path: string,
  body: Buffer,
  contentType: string,
  headers: Record<string, string> = {},
  cookie?: string
): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      {
        hostname: '127.0.0.1',
        port: Number(process.env.CAPACITYLENS_TEST_HTTP_PORT),
        path,
        method: 'POST',
        headers: {
          'content-type': contentType,
          'content-length': String(body.length),
          'sec-fetch-site': 'same-origin',
          ...(cookie ? { cookie: `adonis-session=${cookie}` } : {}),
          ...headers,
        },
      },
      (response) => {
        const chunks: Buffer[] = []
        response.on('data', (chunk: Buffer) => chunks.push(chunk))
        response.on('end', () =>
          resolve({ statusCode: response.statusCode, body: Buffer.concat(chunks).toString('utf8') })
        )
      }
    )
    request.on('error', reject)
    request.end(body)
  })
}

async function reset(client: ApiClient, seeded = true) {
  const session = await resetAuthenticatedData(client, seeded)
  return { client: authenticatedDataClient(client, session.cookie), cookie: session.cookie }
}

test.group('M2a review regressions', (group) => {
  group.setup(() => freshDatabase())

  test('removes the CSP report endpoint', async ({ client, assert }) => {
    const response = await client
      .post('/api/security/csp-report')
      .json({ report: 'ignored' })
      .send()
    assert.equal(response.status(), 404)
    assert.deepEqual(response.body(), { error: 'Not found.', code: 'NOT_FOUND' })
  })

  test('maps actual oversized form and unsupported encoding parser failures safely', async ({
    client,
    assert,
  }) => {
    const fixture = await reset(client, true)
    client = fixture.client
    const cookie = fixture.cookie
    const oversized = await postRaw(
      '/api/accounts/a-studio/example-data',
      Buffer.from(`value=${'x'.repeat(1_100_000)}`),
      'application/x-www-form-urlencoded',
      {},
      cookie
    )
    assert.equal(oversized.statusCode, 413)
    assert.deepEqual(JSON.parse(oversized.body), {
      error: 'Request body is too large.',
      code: 'PAYLOAD_TOO_LARGE',
    })

    const unsupported = await postRaw(
      '/api/accounts/a-studio/example-data',
      Buffer.from('value=x'),
      'application/x-www-form-urlencoded',
      { 'content-encoding': 'compress' },
      cookie
    )
    assert.equal(unsupported.statusCode, 415)
    assert.deepEqual(JSON.parse(unsupported.body), {
      error: 'Unsupported media type.',
      code: 'UNSUPPORTED_MEDIA_TYPE',
    })
  })
})
