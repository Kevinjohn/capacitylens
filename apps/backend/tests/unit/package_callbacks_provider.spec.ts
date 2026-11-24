import { test } from '@japa/runner';
import app from '@adonisjs/core/services/app';
import type { ApplicationService } from '@adonisjs/core/types';
import PackageCallbacksProvider from '#providers/package_callbacks_provider';
import { AdmissionRuleService } from '#services/account_kit/admission_rule_service';
import { nativeAdapter } from '#services/auth/masquerade_authority_service';

type Factory = () => unknown;

/** Boots the provider against a recording container and returns the factories it registered. */
async function registerCallbacks(rules: unknown) {
  const factories: Record<string, Factory> = {};
  const made: unknown[] = [];
  const services = {
    recordInvitationAccepted: async () => {},
    withDeletionRecords: (callback: unknown) => callback,
    requireRegistrationDisplayName: () => 'Diana Prince',
  };
  const container = {
    make: async (key: unknown) => {
      made.push(key);
      if (typeof key === 'string') {
        return { register: (factory: Factory) => (factories[key] = factory) };
      }
      return key === AdmissionRuleService ? rules : services;
    },
  };
  await new PackageCallbacksProvider({ container } as unknown as ApplicationService).boot();
  return { factories, made };
}

test.group('package callbacks provider', () => {
  test('the packages resolve with the callbacks the provider registers', async ({ assert }) => {
    assert.exists(await app.container.make('account_kit'));
    assert.exists(await app.container.make('account_admission'));
    assert.strictEqual(await app.container.make('masquerade.native'), nativeAdapter);
    assert.exists(await app.container.make('password_confirmations'));
  });

  test('the Kit factories build no admission rules, and each callback reaches them', async ({
    assert,
  }) => {
    const calls: unknown[][] = [];
    const rules = {
      admissionAuthorize: {
        decide: async (...args: unknown[]) => calls.push(['decide', ...args]) > 0,
        list: async (...args: unknown[]) => calls.push(['list', ...args]) < 0,
      },
      onCredentialsChangedTransaction: async (...args: unknown[]) => {
        calls.push(['credentials', ...args]);
      },
    };
    const { factories, made } = await registerCallbacks(rules);

    // The Kit runs both factories while it builds its own services, which the rules now inject.
    const accountKit = (await factories['account_kit.callbacks']()) as Record<string, Function>;
    const admission = (await factories['account_admission.callbacks']()) as {
      approvalAuthorize: Record<string, Function>;
    };
    assert.notInclude(made, AdmissionRuleService);

    assert.isTrue(await admission.approvalAuthorize.decide('actor', 'subject', 'context'));
    assert.isFalse(await admission.approvalAuthorize.list('actor', 'context'));
    await accountKit.onCredentialsChangedTransaction('user', 'change', 'trx');
    assert.deepEqual(calls, [
      ['decide', 'actor', 'subject', 'context'],
      ['list', 'actor', 'context'],
      ['credentials', 'user', 'change', 'trx'],
    ]);
  });
});
