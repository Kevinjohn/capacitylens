import { test } from '@japa/runner'
import app from '@adonisjs/core/services/app'

test.group('queued mail failures', () => {
  test('are logged by error name without the message', async ({ assert, cleanup }) => {
    const logged: unknown[][] = []
    const original = console.error
    console.error = (...args: unknown[]) => void logged.push(args)
    cleanup(() => {
      console.error = original
    })
    const emitter = await app.container.make('emitter')
    const error = new TypeError('Refused mail to clark.kent@wayne.example')
    await emitter.emit('queued:mail:error', { error, mailerName: 'smtp' })
    assert.deepEqual(logged, [
      ['Queued mail delivery failed', { mailer: 'smtp', error: 'TypeError' }],
    ])
  })
})
