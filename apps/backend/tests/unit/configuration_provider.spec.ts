import { test } from '@japa/runner';
import {
  bootstrapRecoveryMessage,
  recordBootstrapAdmission,
} from '#services/development_bootstrap';
import ConfigurationProvider, { assertProductionPosture } from '#providers/configuration_provider';

test('production refuses bootstrap, invalid limiter, and reset settings', ({ assert }) => {
  const safe = { allowReset: false, rateLimit: '300' };
  assert.doesNotThrow(() => assertProductionPosture(safe));
  assert.throws(() => assertProductionPosture({ ...safe, createAdmin: true }), /bootstrap/);
  assert.throws(
    () => assertProductionPosture({ ...safe, bootstrapPassword: 'secret' }),
    /bootstrap/
  );
  for (const rateLimit of ['0', ' 100 ', '1e3', '12.5', '+100', '2000000'])
    assert.throws(() => assertProductionPosture({ ...safe, rateLimit }), /RATE_LIMIT/);
  assert.throws(() => assertProductionPosture({ ...safe, allowReset: true }), /ALLOW_RESET/);
});

for (const failedOperation of ['grantInvitation', 'approve'] as const) {
  test(`a ${failedOperation} bootstrap failure reports safe operator recovery`, async ({
    assert,
  }) => {
    const calls: string[] = [];
    const operator = {
      grantInvitation: async () => {
        calls.push('grantInvitation');
        if (failedOperation === 'grantInvitation') throw new Error('private package detail');
        return {} as never;
      },
      approve: async () => {
        calls.push('approve');
        if (failedOperation === 'approve') throw new Error('private package detail');
        return {} as never;
      },
    };
    let failure: unknown;
    try {
      await recordBootstrapAdmission({ operator } as never, 'admin@admin.admin');
    } catch (error) {
      failure = error;
    }
    assert.instanceOf(failure, Error);
    assert.include((failure as Error).message, bootstrapRecoveryMessage());
    assert.notInclude((failure as Error).message, 'private package detail');
    assert.include((failure as Error).message, 'CAPACITYLENS_CREATE_ADMIN_ADMIN=false');
    assert.include((failure as Error).message, 'account-kit:admission:grant-invitation');
    assert.include((failure as Error).message, 'account-kit:admission:approve');
    assert.include((failure as Error).message, 'never changes an existing password');
    assert.instanceOf((failure as Error).cause, Error);
    assert.equal(((failure as Error).cause as Error).message, 'private package detail');
    assert.deepEqual(
      calls,
      failedOperation === 'grantInvitation' ? ['grantInvitation'] : ['grantInvitation', 'approve']
    );
  });
}

for (const state of ['isTerminating', 'isTerminated'] as const) {
  test(`a server whose shutdown already began (${state}) starts no maintenance`, async ({
    assert,
  }) => {
    const hooks: unknown[] = [];
    const application = {
      container: { make: async () => ({ on() {} }) },
      getEnvironment: () => 'web',
      inTest: false,
      isTerminating: state === 'isTerminating',
      isTerminated: state === 'isTerminated',
      terminating: (hook: unknown) => hooks.push(hook),
    };
    const provider = new ConfigurationProvider(application as never);
    await provider.ready();
    await provider.shutdown();
    assert.lengthOf(hooks, 0);
  });
}
