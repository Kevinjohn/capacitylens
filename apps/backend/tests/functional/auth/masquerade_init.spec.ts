import { test } from '@japa/runner';
import db from '@adonisjs/lucid/services/db';
import { MasqueradeError } from '@kevinjohn/adonisjs-masquerade';

type MasqueradeModule = typeof import('#services/auth/masquerade');

/**
 * A module instance whose lazy service promise has never been created, so the result does not
 * depend on whether an earlier test file already initialised the shared instance.
 */
async function freshMasqueradeModule(): Promise<MasqueradeModule> {
  const url = new URL('../../../app/services/auth/masquerade.ts', import.meta.url);
  url.searchParams.set('fresh', crypto.randomUUID());
  return import(url.href);
}

async function failureOf(promise: Promise<unknown>) {
  try {
    await promise;
    return undefined;
  } catch (error) {
    return error;
  }
}

test.group('view-as service initialisation', () => {
  test('a failed initialisation is not cached, so the next caller retries it', async ({
    assert,
  }) => {
    const { masqueradeService } = await freshMasqueradeModule();
    const connection = db.connection.bind(db);
    let injected = 0;
    // The package opens its control store synchronously inside the first call; fail exactly that open.
    db.connection = ((...args: Parameters<typeof db.connection>) => {
      if (injected === 0) {
        injected += 1;
        throw new Error('Simulated transient control-store failure.');
      }
      return connection(...args);
    }) as typeof db.connection;
    let first: Promise<unknown>;
    try {
      first = masqueradeService();
    } finally {
      db.connection = connection;
    }
    assert.equal(injected, 1, 'the injected failure must reach a fresh initialisation');
    const firstError = await failureOf(first);
    assert.instanceOf(firstError, MasqueradeError);
    assert.equal((firstError as MasqueradeError).code, 'E_MASQUERADE_UNAVAILABLE');

    // The store is healthy again; a later request must not inherit the earlier rejection.
    const laterError = await failureOf(masqueradeService());
    assert.notStrictEqual(
      laterError,
      firstError,
      'the later call re-threw the cached rejection from the failed initialisation'
    );
    assert.isUndefined(laterError, 'the later call must initialise the service afresh');
  });
});
