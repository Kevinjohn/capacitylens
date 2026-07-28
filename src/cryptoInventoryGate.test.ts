import { execFileSync, spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

describe('cryptographic inventory file selection', () => {
  let directory: string | null = null

  afterEach(() => {
    if (directory) rmSync(directory, { recursive: true, force: true })
  })

  it('does not fail on an untracked crypto-like scratch file and identifies why', () => {
    directory = mkdtempSync(join(tmpdir(), 'capacitylens-crypto-inventory-'))
    mkdirSync(join(directory, 'scripts'), { recursive: true })
    mkdirSync(join(directory, 'docs/security'), { recursive: true })
    cpSync(
      resolve('scripts/check-crypto-inventory.mjs'),
      join(directory, 'scripts/check-crypto-inventory.mjs'),
    )
    writeFileSync(
      join(directory, 'docs/security/crypto-inventory.json'),
      JSON.stringify({ entries: [] }),
    )
    execFileSync('git', ['init', '--quiet'], { cwd: directory })
    execFileSync(
      'git',
      [
        'add',
        'scripts/check-crypto-inventory.mjs',
        'docs/security/crypto-inventory.json',
      ],
      { cwd: directory },
    )
    writeFileSync(
      join(directory, 'scratch.mjs'),
      `import { randomBytes } from 'node:crypto'\nrandomBytes(8)\n`,
    )

    const result = spawnSync(
      process.execPath,
      ['scripts/check-crypto-inventory.mjs'],
      { cwd: directory, encoding: 'utf8' },
    )

    expect(result.status).toBe(0)
    expect(result.stderr).toContain(
      'Untracked crypto-like files are outside the inventory gate and were ignored',
    )
    expect(result.stderr).toContain('scratch.mjs')
    expect(result.stdout).toContain('0 implementation paths')
  })
})
