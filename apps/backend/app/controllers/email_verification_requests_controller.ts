import { inject } from '@adonisjs/core';
import type { HttpContext } from '@adonisjs/core/http';
import accountKit from '@kevinjohn/adonisjs-account-kit/services/main';
import { isCommittedFailure } from '@kevinjohn/adonisjs-account-kit/errors';
import { CurrentActorService } from '#services/auth/current_actor_service';
import { MailDeliveryService } from '#services/mail_delivery_service';

/** Address confirmation for a signed-in identity, reachable before admission: sending the link. */
@inject()
export default class EmailVerificationRequestsController {
  #currentActor: CurrentActorService;
  #mailDelivery: MailDeliveryService;

  constructor(currentActor: CurrentActorService, mailDelivery: MailDeliveryService) {
    this.#currentActor = currentActor;
    this.#mailDelivery = mailDelivery;
  }

  async store({ auth, response, logger, serialize }: HttpContext) {
    if (!this.#mailDelivery.isMailConfigured()) {
      return response.serviceUnavailable({
        error: 'Email delivery is not configured. Ask your administrator.',
        code: 'E_MAIL_UNAVAILABLE',
      });
    }
    const account = await this.#currentActor.readCurrentAccount(auth);
    try {
      return serialize({
        result: await accountKit.emailVerification.send({ userId: account.id }),
      });
    } catch (error) {
      // Does work: a committed address whose email failed is logged and answered 503.
      if (!isCommittedFailure(error)) throw error;
      logger.warn({ code: 'VERIFICATION_DELIVERY_FAILED' }, 'Verification delivery failed');
      return response.serviceUnavailable({
        error: 'The confirmation email could not be sent. Try again later.',
        code: 'E_MAIL_UNAVAILABLE',
      });
    }
  }
}
