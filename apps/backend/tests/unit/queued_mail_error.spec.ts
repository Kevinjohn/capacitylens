import { test } from '@japa/runner';
import app from '@adonisjs/core/services/app';
import logger from '@adonisjs/core/services/logger';

test.group('queued mail failures', () => {
  test('are logged by error name without the message', async ({ assert, cleanup }) => {
    const logged: unknown[][] = [];
    const original = logger.error;
    logger.error = ((...args: unknown[]) => {
      logged.push(args);
    }) as typeof logger.error;
    cleanup(() => {
      logger.error = original;
    });
    const emitter = await app.container.make('emitter');
    const error = new TypeError('Refused mail to clark.kent@wayne.example');
    await emitter.emit('queued:mail:error', { error, mailerName: 'smtp' });
    assert.lengthOf(logged, 1);
    assert.deepEqual(logged[0], [
      { mailer: 'smtp', errorName: 'TypeError' },
      'Queued mail delivery failed',
    ]);
    assert.notInclude(JSON.stringify(logged[0]), 'clark.kent@wayne.example');
  });
});
