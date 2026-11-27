import { test } from '@japa/runner';
import type { HttpContext } from '@adonisjs/core/http';
import env from '#start/env';
import HttpExceptionHandler from '#exceptions/handler';
import NotFoundException from '#exceptions/not_found_exception';
import RefusalException from '#exceptions/refusal_exception';
import MembershipSuspendedException from '#exceptions/membership_suspended_exception';
import TargetIneligibleException from '#exceptions/target_ineligible_exception';
import { MailDeliveryService } from '#services/mail_delivery_service';

test.group('request helpers', () => {
  test('mail is configured only with a non-blank host', ({ assert, cleanup }) => {
    const mailDelivery = new MailDeliveryService();
    const host = env.get('CAPACITYLENS_MAIL_HOST');
    cleanup(() => env.set('CAPACITYLENS_MAIL_HOST', host ?? ''));
    env.set('CAPACITYLENS_MAIL_HOST', '');
    assert.isFalse(mailDelivery.isMailConfigured());
    env.set('CAPACITYLENS_MAIL_HOST', '   ');
    assert.isFalse(mailDelivery.isMailConfigured());
    env.set('CAPACITYLENS_MAIL_HOST', 'mail.wayne.example');
    assert.isTrue(mailDelivery.isMailConfigured());
  });

  for (const [error, status, body] of [
    [
      new NotFoundException('Not a member of this company.'),
      404,
      { error: 'Not a member of this company.', code: 'E_NOT_FOUND' },
    ],
    [
      new TargetIneligibleException('Choose another Admin.'),
      409,
      { error: 'Choose another Admin.', code: 'E_TARGET_INELIGIBLE' },
    ],
    [
      new MembershipSuspendedException(),
      409,
      {
        error: 'Your membership in this company is suspended. Ask an Owner or Admin to restore it.',
        code: 'E_MEMBERSHIP_SUSPENDED',
      },
    ],
  ] as const) {
    test(`the handler renders ${error.constructor.name} from its own status and code`, async ({
      assert,
    }) => {
      assert.instanceOf(error, RefusalException);
      let sent: unknown;
      let sentStatus = 0;
      const ctx = {
        response: {
          status(value: number) {
            sentStatus = value;
            return this;
          },
          send(value: unknown) {
            sent = value;
          },
        },
      } as unknown as HttpContext;
      await new HttpExceptionHandler().handle(error, ctx);
      assert.equal(sentStatus, status);
      assert.deepEqual(sent, body);
    });
  }
});
