import router from '@adonisjs/core/services/router'

const MasqueradeController = () => import('#controllers/masquerade_controller')

export function registerMasqueradeRoutes() {
  router
    .post('/api/accounts/:accountId/masquerade', [MasqueradeController, 'start'])
    .as('api.masquerade.start')
  router.get('/api/masquerade', [MasqueradeController, 'status']).as('api.masquerade.status')
  router.delete('/api/masquerade', [MasqueradeController, 'end']).as('api.masquerade.end')
}
