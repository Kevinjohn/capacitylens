import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isSupportedNodeVersion } from '../../apps/backend/bin/node_version.ts'
import { reportSpawnFailureAndResolveExitStatus } from '../shared/childProcess.mjs'

const root = fileURLToPath(new URL('../..', import.meta.url))
const startedAt = performance.now()

function run(label, command, args, environment = process.env) {
  console.log(`Checking ${label}...`)
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', env: environment })
  const status = reportSpawnFailureAndResolveExitStatus(label, result)
  if (status !== 0) throw new Error(`${label} failed with exit status ${status}.`)
}

function capture(command, args) {
  const options = { cwd: root, encoding: 'utf8' }
  const result = spawnSync(command, args, options)
  const status = reportSpawnFailureAndResolveExitStatus(command, result)
  if (status !== 0)
    throw new Error(`${command} failed with exit status ${status}: ${result.stderr}`)
  return result.stdout.trim()
}

function main() {
  let passed = false
  try {
    const pnpmVersion = capture('pnpm', ['--version'])
    const pinnedPnpm = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
      .packageManager.split('@')
      .at(-1)
    const commit = capture('git', ['rev-parse', 'HEAD'])
    const dirty = capture('git', ['status', '--porcelain=v1', '--untracked-files=all']).length > 0
    console.log(
      JSON.stringify({
        node: process.version,
        pnpm: pnpmVersion,
        pinnedPnpm,
        pnpmPinMatches: pnpmVersion === pinnedPnpm,
        commit,
        dirty,
        platform: process.platform,
        arch: process.arch,
      })
    )
    if (pnpmVersion !== pinnedPnpm)
      throw new Error(`Expected pinned pnpm ${pinnedPnpm}; found ${pnpmVersion}.`)
    const version = process.versions.node
    if (!version.startsWith('26.') || !isSupportedNodeVersion(version)) {
      throw new Error(`check:node26 requires selected Node >=26.9.0 <27; found ${process.version}.`)
    }

    run('browser storage regression', 'pnpm', [
      '--dir',
      'apps/frontend',
      'exec',
      'vitest',
      'run',
      'src/test/storageCompatibility.test.ts',
    ])
    run('backend lifecycle regressions', 'pnpm', [
      '--dir',
      'apps/backend',
      'test',
      '--files=tests/unit/app_reset_command.spec.ts',
      '--files=tests/unit/owner_reset_command.spec.ts',
      '--files=tests/unit/backup_provider.spec.ts',
      '--files=tests/unit/backup_config.spec.ts',
    ])
    run('production build', 'pnpm', ['run', 'build'], {
      ...process.env,
      NODE_ENV: 'production',
      CAPACITYLENS_PUBLIC_URL: 'https://127.0.0.1',
      HOST: '127.0.0.1',
      PORT: '0',
      LOG_LEVEL: 'error',
      APP_KEY: 'capacitylens-build-key-0123456789abcdef',
      APP_URL: 'http://127.0.0.1',
    })
    passed = true
  } finally {
    console.log(
      JSON.stringify({
        result: passed ? 'passed' : 'failed',
        elapsedSeconds: Math.round((performance.now() - startedAt) / 1000),
      })
    )
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main()
