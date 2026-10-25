import router from '@adonisjs/core/services/router'

const AuthController = () => import('#controllers/auth_controller')
const CredentialController = () => import('#controllers/credential_controller')
const ActionProofsController = () => import('#controllers/action_proofs_controller')
const VerificationController = () => import('#controllers/verification_controller')

export function registerAuthRoutes() {
  router.get('/api/auth/me', [AuthController, 'me']).as('api.auth.me')
  router.post('/api/auth/sign-up', [AuthController, 'signUp']).as('api.auth.sign-up')
  router.post('/api/auth/sign-in', [AuthController, 'signIn']).as('api.auth.sign-in')
  router.post('/api/auth/sign-out', [AuthController, 'signOut']).as('api.auth.sign-out')
  router
    .post('/api/auth/action-proof/password', [ActionProofsController, 'password'])
    .as('api.auth.action-proof.password')
  router
    .post('/api/auth/request-reset', [CredentialController, 'requestReset'])
    .as('api.auth.request-reset')
  router
    .post('/api/auth/inspect-reset', [CredentialController, 'inspectReset'])
    .as('api.auth.inspect-reset')
  router
    .post('/api/auth/reset-password', [CredentialController, 'resetPassword'])
    .as('api.auth.reset-password')
  router
    .post('/api/auth/change-password', [CredentialController, 'changePassword'])
    .as('api.auth.change-password')
  router
    .post('/api/auth/verification/send', [VerificationController, 'send'])
    .as('api.auth.verification.send')
  router
    .post('/api/auth/verification/inspect', [VerificationController, 'inspect'])
    .as('api.auth.verification.inspect')
  router
    .post('/api/auth/verification/complete', [VerificationController, 'complete'])
    .as('api.auth.verification.complete')
}
