import router from '@adonisjs/core/services/router';
import { asOwnAccount } from '#start/route_middleware';
import { controllers } from '#generated/controllers';

export function registerAuthRoutes() {
  router.get('/auth/me', [controllers.Session, 'show']).use(asOwnAccount());
  router.post('/auth/sign-up', [controllers.NewAccount, 'store']).use(asOwnAccount());
  router.post('/auth/sign-in', [controllers.Session, 'store']).use(asOwnAccount());
  router.post('/auth/sign-out', [controllers.Session, 'destroy']);
  router
    .post('/auth/password-confirmation', [controllers.PasswordConfirmations, 'store'])
    .use(asOwnAccount());
  router
    .post('/auth/request-reset', [controllers.PasswordResetRequests, 'store'])
    .use(asOwnAccount());
  router.post('/auth/inspect-reset', [controllers.PasswordResets, 'show']).use(asOwnAccount());
  router.post('/auth/reset-password', [controllers.PasswordResets, 'update']).use(asOwnAccount());
  router.post('/auth/change-password', [controllers.Password, 'update']).use(asOwnAccount());
  router.post('/auth/delete-account', [controllers.Account, 'destroy']).use(asOwnAccount());
  router
    .post('/auth/verification/send', [controllers.EmailVerificationRequests, 'store'])
    .use(asOwnAccount());
  router
    .post('/auth/verification/inspect', [controllers.EmailVerifications, 'show'])
    .use(asOwnAccount());
  router
    .post('/auth/verification/complete', [controllers.EmailVerifications, 'update'])
    .use(asOwnAccount());
}
