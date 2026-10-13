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

test('both E2E flavours boot to database readiness and enable reset', async ({ assert }) => {
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
      const reset = await fetch(`http://127.0.0.1:${port}/api/test/reset`, { method: 'POST' })
      assert.equal(reset.status, 200, `${flavour} reset route`)
      assert.deepEqual(await reset.json(), { ok: true }, `${flavour} reset response`)
    } finally {
      await stop(child, port)
      assert.isTrue(
        await waitForPortRelease(port),
        `${flavour} E2E server should release port ${port}`
      )
    }
  }
})
