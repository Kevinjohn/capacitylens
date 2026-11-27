import { test } from '@japa/runner'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { operatorFixture } from '#tests/helpers/operator_command_helpers'
import {
  interruptedRunSpec,
  lateWorkSpec,
  runTestEntry,
  scratchEntry,
  testEntry,
} from '#tests/helpers/unit/entry_points'

test.group('test entry', () => {
  test('work that outlives its test cannot keep the run alive after the summary', ({
    assert,
    test: t,
  }) => {
    t.timeout(120_000)
    const f = operatorFixture()
    try {
      const app = scratchEntry(f.root, { 'tests/unit/late_work.spec.ts': lateWorkSpec })

      const run = runTestEntry(app, ['--files', 'tests/unit/late_work.spec.ts'])

      assert.equal(run.status, 1, run.output)
      assert.match(run.output, /Tests\s+1 failed/)
    } finally {
      f.cleanup()
    }
  })

  test('a termination signal ends the run before the next test starts', async ({ assert }) => {
    const f = operatorFixture()
    try {
      const app = scratchEntry(f.root, {
        'tests/unit/interrupted_run.spec.ts': interruptedRunSpec,
      })
      const child = spawn(
        process.execPath,
        [...testEntry, '--files', 'tests/unit/interrupted_run.spec.ts'],
        { cwd: app, stdio: ['ignore', 'pipe', 'pipe'] }
      )
      let output = ''
      for (const stream of [child.stdout, child.stderr]) {
        stream.setEncoding('utf8').on('data', (chunk: string) => {
          output += chunk
          if (output.includes('first test started')) child.kill('SIGTERM')
        })
      }
      const unresponsive = setTimeout(() => child.kill('SIGKILL'), 60_000)
      try {
        // A run that outlives the signal still ends: its first test waits five seconds.
        const [, signal] = await once(child, 'exit')
        assert.equal(signal, 'SIGTERM', output)
        assert.notInclude(output, 'second test started')
      } finally {
        clearTimeout(unresponsive)
      }
    } finally {
      f.cleanup()
    }
  }).timeout(120_000)
})
