import router from '@adonisjs/core/services/router'

const MembersController = () => import('#controllers/members_controller')

/** Registers company-scoped member administration and privacy routes. */
export function registerMembershipRoutes() {
  router
    .get('/api/accounts/:accountId/members', [MembersController, 'index'])
    .as('api.members.index')
  router
    .put('/api/accounts/:accountId/member-sign-in-tracking', [MembersController, 'tracking'])
    .as('api.members.tracking')
  router
    .patch('/api/accounts/:accountId/members/:userId', [MembersController, 'changeRole'])
    .as('api.members.role')
  router
    .patch('/api/accounts/:accountId/members/:userId/status', [MembersController, 'changeStatus'])
    .as('api.members.status')
  router
    .post('/api/accounts/:accountId/members/:userId/enable-access', [
      MembersController,
      'enableAccess',
    ])
    .as('api.members.enable-access')
  router
    .delete('/api/accounts/:accountId/members/:userId', [MembersController, 'remove'])
    .as('api.members.remove')
  router
    .post('/api/accounts/:accountId/members/:userId/reset-password', [
      MembersController,
      'resetPassword',
    ])
    .as('api.members.reset-password')
  router
    .post('/api/accounts/:accountId/members/:userId/revoke-sessions', [
      MembersController,
      'revokeSessions',
    ])
    .as('api.members.revoke-sessions')
}
