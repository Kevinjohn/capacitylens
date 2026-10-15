import router from '@adonisjs/core/services/router'

const AuthController = () => import('#controllers/auth_controller')
const CredentialController = () => import('#controllers/credential_controller')

export function registerAuthRoutes() {
  router.get('/api/auth/me', [AuthController, 'me']).as('api.auth.me')
  router.post('/api/auth/sign-up', [AuthController, 'signUp']).as('api.auth.sign-up')
  router.post('/api/auth/sign-in', [AuthController, 'signIn']).as('api.auth.sign-in')
  router.post('/api/auth/sign-out', [AuthController, 'signOut']).as('api.auth.sign-out')
  router
    .post('/api/auth/provider-start', [AuthController, 'providerStart'])
    .as('api.auth.provider-start')
  router
    .post('/api/auth/request-reset', [CredentialController, 'requestReset'])
    .as('api.auth.request-reset')
  router
    .post('/api/auth/reset-password', [CredentialController, 'resetPassword'])
    .as('api.auth.reset-password')
  router
    .post('/api/auth/change-password', [CredentialController, 'changePassword'])
    .as('api.auth.change-password')
}
