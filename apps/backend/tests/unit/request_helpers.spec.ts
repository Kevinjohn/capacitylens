import { test } from '@japa/runner';
import type { HttpContext } from '@adonisjs/core/http';
import env from '#start/env';
import HttpExceptionHandler from '#exceptions/handler';
import { RefusalException } from '#exceptions/refusal_exception';
import { AdmissionException } from '#exceptions/admission_exception';
import { MembershipException } from '#exceptions/membership_exception';
import { OwnershipTransferException } from '#exceptions/ownership_transfer_exception';
import { isMailConfigured } from '#services/mail_delivery';

test.group('request helpers', () => {
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
      new MembershipException('Not a member of this company.', 404, 'NOT_FOUND'),
      { error: 'Not a member of this company.', code: 'NOT_FOUND' },
    ],
    [
      new OwnershipTransferException('Company not found.', 404, 'NOT_FOUND'),
      { error: 'Company not found.', code: 'NOT_FOUND' },
    ],
    [
      new AdmissionException('Admission is not permitted.', 404, 'FORBIDDEN', { state: 'pending' }),
      { error: 'Admission is not permitted.', code: 'FORBIDDEN', decision: { state: 'pending' } },
    ],
  ] as const) {
    test(`the handler renders ${error.constructor.name} from its own status and code`, async ({
      assert,
    }) => {
      assert.instanceOf(error, RefusalException);
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
});
