import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export function operatorFixture() {
  const root = mkdtempSync(join(tmpdir(), 'capacitylens-operator-'))
  const databasePath = join(root, 'source.db')
  const environment = {
    ...process.env,
    NODE_ENV: 'test',
    CAPACITYLENS_DB: databasePath,
    CAPACITYLENS_BACKUP_DIR: '',
    CAPACITYLENS_MODE: 'password-only',
    CAPACITYLENS_SECRET: 'operator-command-secret-2026-1234567890',
    CAPACITYLENS_PUBLIC_URL: 'http://localhost:8787',
    CAPACITYLENS_PASSWORD_BREACH_CHECK: 'false',
    CAPACITYLENS_CREATE_ADMIN_ADMIN: 'false',
    CAPACITYLENS_BOOTSTRAP_ADMIN_PASSWORD: '',
    APP_KEY: 'zKXHe-Ahdb7aPK1ylAJlRgTefktEaACi',
    APP_URL: 'http://localhost:8787',
    SESSION_DRIVER: 'database',
    LOG_LEVEL: 'fatal',
  }
  return {
    root,
    databasePath,
    environment,
    command(
      args: string[],
      overrides: Record<string, string | undefined> = {},
      commandRoot = process.cwd()
    ) {
      const child = spawnSync(process.execPath, ['ace.js', ...args], {
        cwd: commandRoot,
        encoding: 'utf8',
        timeout: 30000,
        env: { ...environment, ...overrides },
      })
      if (child.error) throw child.error
      return { status: child.status, output: `${child.stdout}\n${child.stderr}` }
    },
    inspect() {
      return new DatabaseSync(databasePath)
    },
    cleanup() {
      rmSync(root, { recursive: true, force: true })
    },
  }
}

export function seedOwner(database: DatabaseSync) {
  const now = new Date().toISOString()
  database
    .prepare('INSERT INTO accounts (id,name,color,created_at,updated_at) VALUES (?,?,?,?,?)')
    .run('a-studio', 'Wayne Enterprises', '#6366f1', now, now)
  database
    .prepare(
      'INSERT INTO users (id,email,email_verified,display_name,password_hash,created_at,updated_at) VALUES (?,?,?,?,?,?,?)'
    )
    .run('bruce', 'bruce@wayne.example', 1, 'Bruce Wayne', 'old-credential', now, now)
  database
    .prepare(
      'INSERT INTO memberships (id,account_id,user_id,role,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?)'
    )
    .run('owner', 'a-studio', 'bruce', 'owner', 'active', now, now)
}

export async function withOperatorServer(
  fixture: ReturnType<typeof operatorFixture>,
  run: (origin: string) => Promise<void>
) {
  const { createServer } = await import('node:net')
  const { spawn } = await import('node:child_process')
  const { once } = await import('node:events')
  const server = createServer().listen(0, '127.0.0.1')
  await once(server, 'listening')
  const port = (server.address() as { port: number }).port
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  )
  const child = spawn(process.execPath, ['--import=@poppinss/ts-exec', 'bin/server.ts'], {
    cwd: process.cwd(),
    env: { ...fixture.environment, HOST: '127.0.0.1', PORT: String(port) },
    stdio: 'ignore',
  })
  const exited = once(child, 'exit')
  try {
    const origin = `http://127.0.0.1:${port}`
    for (let attempt = 0; ; attempt++) {
      if (child.exitCode !== null || attempt >= 100)
        throw new Error('Operator fixture server did not become ready')
      try {
        const ready = await fetch(`${origin}/health/ready`)
        if (ready.ok) break
      } catch {
        /* Poll only the disposable fixture. */
      }
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    await run(origin)
  } finally {
    child.kill('SIGTERM')
    const timer = setTimeout(() => child.kill('SIGKILL'), 5000)
    try {
      await exited
    } finally {
      clearTimeout(timer)
    }
  }
}
