import router from '@adonisjs/core/services/router'

const GoogleController = () => import('#controllers/google_controller')

/** Registers the callback, explicit identity link, and Google company-join journey. */
export function registerGoogleRoutes() {
  router.get('/api/auth/callback/google', [GoogleController, 'callback']).as('api.google.callback')
  router.post('/api/identity/link-provider', [GoogleController, 'linkStart']).as('api.google.link')
  router.get('/api/identity/provider', [GoogleController, 'providerInfo']).as('api.google.identity')
  router
    .post('/api/accounts/:accountId/join/provider/start', [GoogleController, 'joinStart'])
    .as('api.google.join-start')
  router
    .post('/api/company-join/cancel', [GoogleController, 'joinCancel'])
    .as('api.google.join-cancel')
  router
    .post('/api/company-join/complete-provider', [GoogleController, 'joinComplete'])
    .as('api.google.join-complete')
}
