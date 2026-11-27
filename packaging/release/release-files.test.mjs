import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

test('the service unit runs the clone with the system Node and the root-only environment', async () => {
  const unit = await read('packaging/release/capacitylens.service')
  for (const line of [
    'User=capacitylens',
    'WorkingDirectory=/opt/capacitylens/apps/backend/build',
    'EnvironmentFile=/etc/capacitylens.env',
    'Environment=NODE_ENV=production',
    'ExecStart=/usr/bin/env node /opt/capacitylens/apps/backend/build/bin/server.js',
    'TimeoutStopSec=30',
    'Restart=on-failure',
  ]) {
    assert.match(unit, new RegExp(`^${line.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}$`, 'm'), line)
  }
})

const headerValues = (conf) =>
  Object.fromEntries(
    [
      ...conf.matchAll(/^\s*add_header\s+(\S+)\s+(?:"([^"]*)"|'([^']*)'|(\S+))(?:\s+always)?;/gm),
    ].map((match) => [match[1], match[2] ?? match[3] ?? match[4]])
  )

test("the nginx site's headers and log suppression stay in step with the web image", async () => {
  const site = await read('packaging/release/capacitylens.nginx.conf')
  const edge = await read('nginx.conf')
  const expected = headerValues(await read('nginx-security-headers.conf'))
  expected['Content-Security-Policy'] = expected['Content-Security-Policy'].replace(
    '$capacitylens_connect_src',
    "'self'"
  )
  expected['Cache-Control'] = '$capacitylens_cache_control'
  assert.deepEqual(headerValues(site), expected)

  const silenced = (conf) =>
    [...conf.matchAll(/location\s+(~[^{]*)\{\s*access_log off;/g)].map((match) => match[1])
  assert.equal(silenced(edge).length, 2)
  assert.deepEqual(silenced(site), silenced(edge))
  assert.match(site, /client_max_body_size 6m;/)
  assert.match(site, /root \/opt\/capacitylens\/apps\/backend\/build\/public;/)
  const health = site.match(/location \^~ \/health\/ \{([^}]*)\}/)?.[1]
  assert.ok(health, 'Health routes must be proxied to the backend.')
  assert.match(health, /proxy_pass http:\/\/127\.0\.0\.1:8787;/)
  assert.doesNotMatch(health, /try_files|add_header/)
  assert.match(site, /proxy_read_timeout 130s;/)
  assert.match(site, /return 301 https:\/\/\$host\$request_uri;/)
})

test('every shipped nginx config keeps browser bearer routes out of the access log', async () => {
  for (const path of ['nginx.conf', 'packaging/release/capacitylens.nginx.conf']) {
    const conf = await read(path)
    const locations = [...conf.matchAll(/location\s+(~\*?)\s+([^\s{]+)\s*\{([^}]+)\}/g)].map(
      ([, operator, expression, body]) => ({
        matcher: new RegExp(expression, operator === '~*' ? 'i' : ''),
        body,
      })
    )
    const bearerRoutes = [
      ['/invitation/opaque-bearer', '/InViTaTiOn/opaque-bearer/'],
      ['/reset-password/opaque-bearer', '/ReSeT-PaSsWoRd/opaque-bearer/'],
      ['/verify-email/opaque-bearer', '/VeRiFy-EmAiL/opaque-bearer/'],
    ]
    for (const route of bearerRoutes.flat()) {
      const location = locations.find(({ matcher }) => matcher.test(route))
      assert.ok(location, `${path}: ${route}`)
      assert.match(location.body, /access_log off;/)
    }
    for (const route of ['/projects/ordinary-path', '/invitation', '/invitees/ordinary-path']) {
      const location = locations.find(({ matcher }) => matcher.test(route))
      assert.equal(location, undefined, `${path}: ordinary route ${route} must not match`)
    }
  }
})
