import router from '@adonisjs/core/services/router';
import { asOwnAccount } from '#start/route_guards';

const AuthController = () => import('#controllers/auth_controller');
const CredentialController = () => import('#controllers/credential_controller');
const PasswordConfirmationsController = () =>
  import('#controllers/password_confirmations_controller');
const VerificationController = () => import('#controllers/verification_controller');

export function registerAuthRoutes() {
  router.get('/api/auth/me', [AuthController, 'me']).as('api.auth.me').use(asOwnAccount());
  router
    .post('/api/auth/sign-up', [AuthController, 'signUp'])
    .as('api.auth.sign-up')
    .use(asOwnAccount());
  router
    .post('/api/auth/sign-in', [AuthController, 'signIn'])
    .as('api.auth.sign-in')
    .use(asOwnAccount());
  router.post('/api/auth/sign-out', [AuthController, 'signOut']).as('api.auth.sign-out');
  router
    .post('/api/auth/password-confirmation', [PasswordConfirmationsController, 'password'])
    .as('api.auth.password-confirmation')
    .use(asOwnAccount());
  router
    .post('/api/auth/request-reset', [CredentialController, 'requestReset'])
    .as('api.auth.request-reset')
    .use(asOwnAccount());
  router
    .post('/api/auth/inspect-reset', [CredentialController, 'inspectReset'])
    .as('api.auth.inspect-reset')
    .use(asOwnAccount());
  router
    .post('/api/auth/reset-password', [CredentialController, 'resetPassword'])
    .as('api.auth.reset-password')
    .use(asOwnAccount());
  router
    .post('/api/auth/change-password', [CredentialController, 'changePassword'])
    .as('api.auth.change-password')
    .use(asOwnAccount());
  router
    .post('/api/auth/delete-account', [CredentialController, 'deleteAccount'])
    .as('api.auth.delete-account')
    .use(asOwnAccount());
  router
    .post('/api/auth/verification/send', [VerificationController, 'send'])
    .as('api.auth.verification.send')
    .use(asOwnAccount());
  router
    .post('/api/auth/verification/inspect', [VerificationController, 'inspect'])
    .as('api.auth.verification.inspect')
    .use(asOwnAccount());
  router
    .post('/api/auth/verification/complete', [VerificationController, 'complete'])
    .as('api.auth.verification.complete')
    .use(asOwnAccount());
}
