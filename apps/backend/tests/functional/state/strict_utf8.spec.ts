import { test } from '@japa/runner'
import { request as httpRequest } from 'node:http'
import { freshDatabase } from '../../helpers/fresh_database.js'
import { resetAuthenticatedData } from '../../helpers/authenticated_data_fixture.js'

function postRawJson(
  body: Buffer,
  cookieHeader: string
): Promise<{ statusCode: number | undefined; body: string }> {
  return new Promise((resolve, reject) => {
    const port = Number(process.env.CAPACITYLENS_TEST_HTTP_PORT)
    const request = httpRequest(
      {
        hostname: '127.0.0.1',
        port,
        path: '/api/accounts/a-studio/allocations/create-group',
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': body.length,
          'cookie': cookieHeader,
          'sec-fetch-site': 'same-origin',
        },
      },
      (response) => {
        const chunks: Buffer[] = []
        response.on('data', (chunk: Buffer) => chunks.push(chunk))
        response.on('end', () =>
          resolve({
            statusCode: response.statusCode,
            body: Buffer.concat(chunks).toString('utf8'),
          })
        )
      }
    )
    request.on('error', reject)
    request.end(body)
  })
}

test.group('M1 framework JSON parsing', (group) => {
  group.setup(() => freshDatabase())

  test('passes malformed UTF-8 bytes through parsing to typed route validation', async ({
    client,
    assert,
  }) => {
    const { cookieHeader } = await resetAuthenticatedData(client, true)
    const body = Buffer.concat([
      Buffer.from('{"intent":"', 'utf8'),
      Buffer.from([0xc3, 0x28]),
      Buffer.from('"}', 'utf8'),
    ])
    const response = await postRawJson(body, cookieHeader)

    assert.equal(response.statusCode, 400)
    assert.equal(JSON.parse(response.body).code, 'validation_error')
  })

  test('passes valid non-ASCII UTF-8 JSON bytes to normal route validation', async ({
    client,
    assert,
  }) => {
    const { cookieHeader } = await resetAuthenticatedData(client, true)
    const body = Buffer.from('{"intent":"café"}', 'utf8')
    const response = await postRawJson(body, cookieHeader)

    assert.equal(response.statusCode, 400)
    assert.equal(JSON.parse(response.body).code, 'validation_error')
  })
})
