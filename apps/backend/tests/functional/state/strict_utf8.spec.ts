import { test } from '@japa/runner'
import { request as httpRequest } from 'node:http'
import testUtils from '@adonisjs/core/services/test_utils'
import { replaceWithSeed } from '#services/state_repository'

function postRawJson(body: Buffer): Promise<{ statusCode: number | undefined; body: string }> {
  return new Promise((resolve, reject) => {
    const port = Number(process.env.CAPACITYLENS_TEST_HTTP_PORT)
    const request = httpRequest(
      {
        hostname: '127.0.0.1',
        port,
        path: '/api/test/reset',
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': body.length,
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

test.group('M1 strict UTF-8 JSON boundary', (group) => {
  group.setup(() => testUtils.db().migrate())
  group.each.setup(() => replaceWithSeed())

  test('rejects malformed UTF-8 JSON bytes before route validation', async ({ assert }) => {
    const body = Buffer.concat([
      Buffer.from('{"seed":true,"name":"', 'utf8'),
      Buffer.from([0xc3, 0x28]),
      Buffer.from('"}', 'utf8'),
    ])
    const response = await postRawJson(body)

    assert.equal(response.statusCode, 400)
    assert.deepEqual(JSON.parse(response.body), {
      error: "Body is not valid JSON but content-type is set to 'application/json'.",
    })
  })

  test('passes valid non-ASCII UTF-8 JSON bytes to normal route validation', async ({ assert }) => {
    const body = Buffer.from('{"seed":"café"}', 'utf8')
    const response = await postRawJson(body)

    assert.equal(response.statusCode, 400)
    assert.deepEqual(JSON.parse(response.body), { error: 'Invalid reset request.' })
  })
})
