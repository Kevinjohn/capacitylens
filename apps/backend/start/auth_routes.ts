import router from '@adonisjs/core/services/router';
import { asOwnAccount } from '#start/route_middleware';
import { controllers } from '#generated/controllers';

export function registerAuthRoutes() {
  router.get('/api/auth/me', [controllers.Session, 'show']).as('api.auth.me').use(asOwnAccount());
  router
    .post('/api/auth/sign-up', [controllers.NewAccount, 'store'])
    .as('api.auth.sign-up')
    .use(asOwnAccount());
  router
    .post('/api/auth/sign-in', [controllers.Session, 'store'])
    .as('api.auth.sign-in')
    .use(asOwnAccount());
  router.post('/api/auth/sign-out', [controllers.Session, 'destroy']).as('api.auth.sign-out');
  router
    .post('/api/auth/password-confirmation', [controllers.PasswordConfirmations, 'store'])
    .as('api.auth.password-confirmation')
    .use(asOwnAccount());
  router
    .post('/api/auth/request-reset', [controllers.PasswordResetRequests, 'store'])
    .as('api.auth.request-reset')
    .use(asOwnAccount());
  router
    .post('/api/auth/inspect-reset', [controllers.PasswordResets, 'show'])
    .as('api.auth.inspect-reset')
    .use(asOwnAccount());
  router
    .post('/api/auth/reset-password', [controllers.PasswordResets, 'update'])
    .as('api.auth.reset-password')
    .use(asOwnAccount());
  router
    .post('/api/auth/change-password', [controllers.Password, 'update'])
    .as('api.auth.change-password')
    .use(asOwnAccount());
  router
    .post('/api/auth/delete-account', [controllers.Account, 'destroy'])
    .as('api.auth.delete-account')
    .use(asOwnAccount());
  router
    .post('/api/auth/verification/send', [controllers.EmailVerificationRequests, 'store'])
    .as('api.auth.verification.send')
    .use(asOwnAccount());
  router
    .post('/api/auth/verification/inspect', [controllers.EmailVerifications, 'show'])
    .as('api.auth.verification.inspect')
    .use(asOwnAccount());
  router
    .post('/api/auth/verification/complete', [controllers.EmailVerifications, 'update'])
    .as('api.auth.verification.complete')
    .use(asOwnAccount());
}
