import { spawn } from 'node:child_process'
import { test } from '@japa/runner'
import { portInUse, terminateProcessTree } from '../../../../../scripts/devProcesses.mjs'
import { ports } from '../../../../../scripts/ports.mjs'

const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds))

async function waitForReadiness(
  child: ReturnType<typeof spawn>,
  url: string,
  flavour: string,
  output: () => string
) {
  for (let attempt = 0; attempt < 80; attempt++) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`The ${flavour} E2E server exited before readiness. ${output()}`)
    }
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1000) })
      if (response.ok) return
    } catch {
      await wait(100)
    }
  }
  throw new Error(`The ${flavour} E2E server did not become ready.`)
}

async function waitForPortRelease(port: number) {
  for (let attempt = 0; attempt < 50; attempt++) {
    if (!(await portInUse(port))) return true
    await wait(100)
  }
  return false
}

function signalOwnedProcessGroup(child: ReturnType<typeof spawn>, signal: NodeJS.Signals) {
  if (process.platform === 'win32' || child.pid === undefined) return
  try {
    process.kill(-child.pid, signal)
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ESRCH') {
      return
    }
    throw error
  }
}

async function stop(child: ReturnType<typeof spawn>, port: number) {
  if (child.pid === undefined) return
  if (child.exitCode === null && child.signalCode === null) {
    await terminateProcessTree(child, { graceMs: 5000, forceMs: 1000 })
  } else {
    signalOwnedProcessGroup(child, 'SIGTERM')
  }
  if (await waitForPortRelease(port)) return
  signalOwnedProcessGroup(child, 'SIGKILL')
  await waitForPortRelease(port)
}

test('E2E flavours use native authenticated sessions and refuse installation reset', async ({
  assert,
}) => {
  for (const flavour of ['db', 'auth'] as const) {
    const lane = ports()
    const port = flavour === 'db' ? lane.dbApi : lane.authApi
    const child = spawn(process.execPath, ['scripts/e2e-server.mjs', flavour], {
      cwd: new URL('../../../', import.meta.url),
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let output = ''
    const capture = (chunk: Buffer) => {
      output = (output + chunk.toString()).slice(-12_000)
    }
    child.stdout?.on('data', capture)
    child.stderr?.on('data', capture)
    try {
      await waitForReadiness(child, `http://127.0.0.1:${port}/health/ready`, flavour, () => output)
      const resetUrl = `http://127.0.0.1:${port}/api/test/reset`
      const anonymousReset = await fetch(resetUrl, { method: 'POST' })
      assert.equal(anonymousReset.status, 401, 'auth-on reset rejects unauthenticated callers')

      const signedIn = await fetch(`http://127.0.0.1:${port}/api/auth/sign-in`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: 'admin@admin.admin',
          password: 'auth-e2e-password-2026',
        }),
      })
      assert.equal(signedIn.status, 200, 'the disposable credential-only bootstrap signs in')
      const cookie = signedIn.headers
        .getSetCookie()
        .map((value) => value.split(';', 1)[0])
        .join('; ')
      assert.isNotEmpty(cookie, 'password sign-in creates a native session cookie')

      const session = await fetch(`http://127.0.0.1:${port}/api/auth/me`, {
        headers: { cookie },
      })
      assert.equal(
        session.status,
        200,
        'the database-backed session authenticates the next request'
      )

      const memberlessReset = await fetch(resetUrl, {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ seed: true }),
      })
      assert.equal(
        memberlessReset.status,
        403,
        'the authenticated bootstrap has no membership and cannot reset the fixture'
      )
    } finally {
      await stop(child, port)
      assert.isTrue(
        await waitForPortRelease(port),
        `${flavour} E2E server should release port ${port}`
      )
    }
  }
})
