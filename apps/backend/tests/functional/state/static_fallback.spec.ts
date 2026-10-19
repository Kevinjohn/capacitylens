import { test } from '@japa/runner'
import app from '@adonisjs/core/services/app'
import testUtils from '@adonisjs/core/services/test_utils'
import { readdir } from 'node:fs/promises'

const strictPolicy =
  "default-src 'self'; script-src 'self'; style-src 'self'; style-src-attr 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'none'; form-action 'self'; report-uri /api/security/csp-report; report-to csp-endpoint"

test.group('M1 static fallback', (group) => {
  group.setup(() => testUtils.db().migrate())
  test('serves the shell only for SPA routes', async ({ client, assert }) => {
    for (const path of ['/', '/schedule/week/2026-10-05', '/invite/abc', '/reset-password/abc']) {
      const response = await client.get(path)
      assert.equal(response.status(), 200, path)
      assert.include(response.header('content-type'), 'text/html')
      assert.equal(response.header('cache-control'), 'no-store')
      assert.equal(response.header('content-security-policy'), strictPolicy)
    }
  })

  test('does not turn missing files, directories, traversal, or APIs into the shell', async ({
    client,
    assert,
  }) => {
    for (const path of [
      '/missing.js',
      '/offline-worker.js',
      '/assets/missing.js',
      '/nested/missing.png',
      '/assets/',
      '/assets/..%2F..%2Fpackage.json',
    ]) {
      const response = await client.get(path)
      assert.equal(response.status(), 404, path)
      assert.notInclude(response.text(), '<!doctype html>')
    }
    const api = await client.get('/api/does-not-exist')
    assert.equal(api.status(), 404)
    assert.deepEqual(api.body(), { error: 'Not found' })
  })

  test('serves hashed assets as immutable and root files as no-store', async ({
    client,
    assert,
  }) => {
    const assets = await readdir(app.publicPath('assets'))
    const asset = assets.find((name) => name.endsWith('.js'))
    assert.isString(asset)
    const response = await client.get(`/assets/${asset}`)
    assert.equal(response.status(), 200)
    assert.equal(response.header('cache-control'), 'public, max-age=31536000, immutable')
    assert.equal(response.header('content-security-policy'), strictPolicy)
    const etag = response.header('etag')
    assert.isString(etag)
    const revalidated = await client.get(`/assets/${asset}`).header('if-none-match', etag!)
    assert.equal(revalidated.status(), 304)
    assert.equal(revalidated.header('cache-control'), 'public, max-age=31536000, immutable')
    const rootFile = await client.get('/theme-init.js')
    assert.equal(rootFile.status(), 200)
    assert.equal(rootFile.header('cache-control'), 'no-store')
  })
})
