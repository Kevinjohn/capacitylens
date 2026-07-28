import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { spawn } from 'node:child_process'
import { describe, expect, it } from 'vitest'

const harness = join(process.cwd(), 'scripts/e2e-oidc.mjs')

describe('strict OIDC E2E harness', () => {
  it('selects the complete OIDC project instead of one literal spec file', () => {
    const source = readFileSync(harness, 'utf8')

    expect(source).toContain('"--project=oidc-backed"')
    expect(source).not.toContain('"e2e/oidc.oidc.spec.ts"')
  })

  it('removes Dex before exiting on SIGTERM', async () => {
    const fixture = mkdtempSync(join(tmpdir(), 'capacitylens-oidc-signal-'))
    const calls = join(fixture, 'docker-calls.txt')
    const docker = join(fixture, 'docker')
    writeFileSync(docker, `#!/bin/sh\nprintf '%s\\n' "$*" >> "$OIDC_DOCKER_CALLS"\n`)
    chmodSync(docker, 0o700)

    try {
      const child = spawn(process.execPath, [harness], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          PATH: `${fixture}${delimiter}${process.env.PATH ?? ''}`,
          OIDC_DOCKER_CALLS: calls,
        },
        stdio: 'ignore',
      })
      await new Promise<void>((resolve, reject) => {
        const deadline = Date.now() + 5_000
        const poll = () => {
          try {
            if (readFileSync(calls, 'utf8').startsWith('run ')) return resolve()
          } catch {
            // The fake Docker command has not written its first call yet.
          }
          if (Date.now() >= deadline) return reject(new Error('OIDC harness did not start Dex.'))
          setTimeout(poll, 10)
        }
        poll()
      })
      child.kill('SIGTERM')
      const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
        child.once('exit', (code, signal) => resolve({ code, signal }))
      })

      expect(exit).toEqual({ code: 143, signal: null })
      expect(readFileSync(calls, 'utf8')).toMatch(
        /^run [\s\S]*\nlogs --timestamps capacitylens-oidc-e2e-\d+\nrm --force capacitylens-oidc-e2e-\d+\n$/,
      )
    } finally {
      rmSync(fixture, { recursive: true, force: true })
    }
  })
})
