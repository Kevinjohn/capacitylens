import { once } from 'node:events'
import { spawn } from 'node:child_process'
import { test } from '@japa/runner'
import { ports } from '../../../../../scripts/ports.mjs'

const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds))

async function waitForReadiness(child: ReturnType<typeof spawn>, url: string, flavour: string) {
  for (let attempt = 0; attempt < 80; attempt++) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`The ${flavour} E2E server exited before readiness.`)
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

async function stop(child: ReturnType<typeof spawn>) {
  if (child.exitCode !== null || child.signalCode !== null) return

  const exited = once(child, 'exit')
  child.kill('SIGTERM')
  const forceKill = setTimeout(() => child.kill('SIGKILL'), 5000)
  await exited
  clearTimeout(forceKill)
}

test('both E2E flavours boot to database readiness and enable reset', async ({ assert }) => {
  for (const flavour of ['db', 'auth'] as const) {
    const lane = ports()
    const port = flavour === 'db' ? lane.dbApi : lane.authApi
    const child = spawn(process.execPath, ['scripts/e2e-server.mjs', flavour], {
      cwd: new URL('../../../', import.meta.url),
      stdio: 'ignore',
    })

    try {
      await waitForReadiness(child, `http://127.0.0.1:${port}/health/ready`, flavour)
      const reset = await fetch(`http://127.0.0.1:${port}/api/test/reset`, { method: 'POST' })
      assert.equal(reset.status, 200, `${flavour} reset route`)
      assert.deepEqual(await reset.json(), { ok: true }, `${flavour} reset response`)
    } finally {
      await stop(child)
    }
  }
})
