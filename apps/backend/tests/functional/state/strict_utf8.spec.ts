import { test } from '@japa/runner'
import { freshDatabase } from '#tests/helpers/fresh_database'
import { resetAuthenticatedData } from '#tests/helpers/authenticated_data_fixture'
import { postRawJson, readContextToken } from '#tests/helpers/state/strict_utf8'

test.group('framework JSON parsing', (group) => {
  group.setup(() => freshDatabase())

  test('passes malformed UTF-8 bytes through parsing to typed route validation', async ({
    client,
    assert,
  }) => {
    const session = await resetAuthenticatedData(client, true)
    const token = await readContextToken(client, session.cookie)
    const body = Buffer.concat([
      Buffer.from('{"intent":"', 'utf8'),
      Buffer.from([0xc3, 0x28]),
      Buffer.from('"}', 'utf8'),
    ])
    const response = await postRawJson(body, session.cookieHeader, token)

    assert.equal(response.statusCode, 422)
    assert.isNotEmpty(JSON.parse(response.body).errors)
  })

  test('passes valid non-ASCII UTF-8 JSON bytes to normal route validation', async ({
    client,
    assert,
  }) => {
    const session = await resetAuthenticatedData(client, true)
    const token = await readContextToken(client, session.cookie)
    const body = Buffer.from('{"intent":"café"}', 'utf8')
    const response = await postRawJson(body, session.cookieHeader, token)

    assert.equal(response.statusCode, 422)
    assert.isNotEmpty(JSON.parse(response.body).errors)
  })
})
