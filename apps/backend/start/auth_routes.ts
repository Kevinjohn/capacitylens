import router from '@adonisjs/core/services/router';
import { asOwnAccount } from '#start/route_middleware';
import { controllers } from '#generated/controllers';

export function registerAuthRoutes() {
  router.get('/api/auth/me', [controllers.Auth, 'me']).as('api.auth.me').use(asOwnAccount());
  router
    .post('/api/auth/sign-up', [controllers.Auth, 'signUp'])
    .as('api.auth.sign-up')
    .use(asOwnAccount());
  router
    .post('/api/auth/sign-in', [controllers.Auth, 'signIn'])
    .as('api.auth.sign-in')
    .use(asOwnAccount());
  router.post('/api/auth/sign-out', [controllers.Auth, 'signOut']).as('api.auth.sign-out');
  router
    .post('/api/auth/password-confirmation', [controllers.PasswordConfirmations, 'password'])
    .as('api.auth.password-confirmation')
    .use(asOwnAccount());
  router
    .post('/api/auth/request-reset', [controllers.Credential, 'requestReset'])
    .as('api.auth.request-reset')
    .use(asOwnAccount());
  router
    .post('/api/auth/inspect-reset', [controllers.Credential, 'inspectReset'])
    .as('api.auth.inspect-reset')
    .use(asOwnAccount());
  router
    .post('/api/auth/reset-password', [controllers.Credential, 'resetPassword'])
    .as('api.auth.reset-password')
    .use(asOwnAccount());
  router
    .post('/api/auth/change-password', [controllers.Credential, 'changePassword'])
    .as('api.auth.change-password')
    .use(asOwnAccount());
  router
    .post('/api/auth/delete-account', [controllers.Credential, 'deleteAccount'])
    .as('api.auth.delete-account')
    .use(asOwnAccount());
  router
    .post('/api/auth/verification/send', [controllers.Verification, 'send'])
    .as('api.auth.verification.send')
    .use(asOwnAccount());
  router
    .post('/api/auth/verification/inspect', [controllers.Verification, 'inspect'])
    .as('api.auth.verification.inspect')
    .use(asOwnAccount());
  router
    .post('/api/auth/verification/complete', [controllers.Verification, 'complete'])
    .as('api.auth.verification.complete')
    .use(asOwnAccount());
}
