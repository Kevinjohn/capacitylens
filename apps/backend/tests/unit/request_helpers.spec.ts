import { test } from '@japa/runner';
import type { HttpContext } from '@adonisjs/core/http';
import env from '#start/env';
import HttpExceptionHandler from '#exceptions/handler';
import { RefusalError } from '#exceptions/refusal_error';
import { AdmissionError } from '#services/admission/errors';
import { MembershipError } from '#services/membership/member_mutations';
import { OwnershipTransferError } from '#services/membership/ownership_transfer';
import { isMailConfigured } from '#services/mail_delivery';
import { hasOnlyFields } from '#services/request_helpers';

test('a request body is a plain object with no key outside the allowed set', ({ assert }) => {
  assert.isTrue(hasOnlyFields({}, []));
  assert.isTrue(hasOnlyFields({ role: 'admin' }, ['role', 'email']));
  assert.isFalse(hasOnlyFields({ role: 'admin', extra: 1 }, ['role']));
  assert.isFalse(hasOnlyFields({ extra: 1 }, []));
  for (const value of [null, undefined, 'text', 7, [], [{ role: 'admin' }]]) {
    assert.isFalse(hasOnlyFields(value, ['role']));
  }
});

test('mail is configured only with a non-blank host', ({ assert, cleanup }) => {
  const host = env.get('CAPACITYLENS_MAIL_HOST');
  cleanup(() => env.set('CAPACITYLENS_MAIL_HOST', host ?? ''));
  env.set('CAPACITYLENS_MAIL_HOST', '');
  assert.isFalse(isMailConfigured());
  env.set('CAPACITYLENS_MAIL_HOST', '   ');
  assert.isFalse(isMailConfigured());
  env.set('CAPACITYLENS_MAIL_HOST', 'mail.wayne.example');
  assert.isTrue(isMailConfigured());
});

for (const [error, body] of [
  [
    new MembershipError('Not a member of this company.', 404, 'NOT_FOUND'),
    { error: 'Not a member of this company.', code: 'NOT_FOUND' },
  ],
  [
    new OwnershipTransferError('Company not found.', 404, 'NOT_FOUND'),
    { error: 'Company not found.', code: 'NOT_FOUND' },
  ],
  [
    new AdmissionError('Admission is not permitted.', 404, 'FORBIDDEN', { state: 'pending' }),
    { error: 'Admission is not permitted.', code: 'FORBIDDEN', decision: { state: 'pending' } },
  ],
] as const) {
  test(`the handler renders ${error.constructor.name} from its own status and code`, async ({
    assert,
  }) => {
    assert.instanceOf(error, RefusalError);
    let sent: unknown;
    let status = 0;
    const ctx = {
      response: {
        status(value: number) {
          status = value;
          return this;
        },
        send(value: unknown) {
          sent = value;
        },
      },
    } as unknown as HttpContext;
    await new HttpExceptionHandler().handle(error, ctx);
    assert.equal(status, 404);
    assert.deepEqual(sent, body);
  });
}
