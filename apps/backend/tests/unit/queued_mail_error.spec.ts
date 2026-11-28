import { test } from '@japa/runner'
import emitter from '@adonisjs/core/services/emitter'
import logger from '@adonisjs/core/services/logger'
import loggerConfig from '#config/logger'

test.group('queued mail failures', () => {
  test('queued mail failures are logged under err and serialized without the message', async ({
    assert,
    cleanup,
  }) => {
    const logged: unknown[][] = []
    const original = logger.error
    logger.error = ((...args: unknown[]) => {
      logged.push(args)
    }) as typeof logger.error
    cleanup(() => {
      logger.error = original
    })
    const error = new TypeError('Refused mail to clark.kent@wayne.example')
    await emitter.emit('queued:mail:error', { error, mailerName: 'smtp' })
    assert.lengthOf(logged, 1)
    assert.deepEqual(logged[0], [{ mailer: 'smtp', err: error }, 'Queued mail delivery failed'])
    const serialized = loggerConfig.loggers.app.serializers!.err!(error)
    assert.deepEqual(serialized, { category: 'unexpected', errorName: 'TypeError' })
    assert.notInclude(JSON.stringify(serialized), 'clark.kent@wayne.example')
  })
})
