import { supportsNodeVersion } from '#start/node_version'
import { test } from '@japa/runner'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('native web and Ace entries refuse unsupported Node before creating a database', ({
  assert,
  test: t,
}) => {
  t.timeout(40000)
  const root = mkdtempSync(join(tmpdir(), 'capacitylens-node-entry-'))
  try {
    const preload = join(root, 'version.cjs')
    writeFileSync(preload, "Object.defineProperty(process.versions, 'node', { value: '24.18.0' })")
    for (const args of [
      ['ace.js', 'app:upgrade'],
      ['--import=@poppinss/ts-exec', 'bin/server.ts'],
    ]) {
      const database = join(root, `${args.length}.db`)
      const result = spawnSync(process.execPath, ['--require', preload, ...args], {
        cwd: process.cwd(),
        encoding: 'utf8',
        timeout: 15000,
        env: { ...process.env, CAPACITYLENS_DB: database },
      })
      assert.notEqual(result.status, 0)
      assert.match(
        `${result.stdout}\n${result.stderr}`,
        /requires Node >=24.19.0 <25 or >=26.9.0 <27/
      )
      assert.isFalse(existsSync(database))
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('native server runtime versions preserve the released acceptance boundary', ({ assert }) => {
  for (const version of ['24.19.0', '24.21.0', '26.9.0', '26.11.1'])
    assert.isTrue(supportsNodeVersion(version), version)
  for (const version of ['22.0.0', '24.18.9', '25.0.0', '26.8.9', '27.0.0', '24.19', 'v24.19.0'])
    assert.isFalse(supportsNodeVersion(version), version)
})
