import router from '@adonisjs/core/services/router'

const InvitationsController = () => import('#controllers/invitations_controller')
const JoiningController = () => import('#controllers/joining_controller')
const MemberResourcesController = () => import('#controllers/member_resources_controller')

/** Registers company admission, invitation, and member resource routes. */
export function registerAdmissionRoutes() {
  router.post('/api/invites', [InvitationsController, 'create']).as('api.invites.create')
  router
    .get('/api/accounts/:accountId/invites', [InvitationsController, 'index'])
    .as('api.invites.index')
  router
    .delete('/api/accounts/:accountId/invites/:id', [InvitationsController, 'revoke'])
    .as('api.invites.revoke')
  router
    .get('/api/invites/:token/preview', [InvitationsController, 'preview'])
    .as('api.invites.preview')
  router
    .post('/api/invites/:token/accept', [InvitationsController, 'accept'])
    .as('api.invites.accept')
  router
    .post('/api/invites/:token/signup', [InvitationsController, 'signUp'])
    .as('api.invites.sign-up')

  router
    .get('/api/accounts/:accountId/joining-policy', [JoiningController, 'policy'])
    .as('api.joining.policy')
  router
    .put('/api/accounts/:accountId/joining-policy', [JoiningController, 'updatePolicy'])
    .as('api.joining.update-policy')
  router
    .get('/api/accounts/:accountId/join/metadata', [JoiningController, 'metadata'])
    .as('api.joining.metadata')
  router.get('/api/company-join/status', [JoiningController, 'status']).as('api.joining.status')
  router
    .post('/api/accounts/:accountId/join/complete-existing', [
      JoiningController,
      'completeExisting',
    ])
    .as('api.joining.complete-existing')
  router
    .post('/api/accounts/:accountId/join/verify-email', [JoiningController, 'requestProof'])
    .as('api.joining.request-proof')
  router
    .post('/api/company-join/verify-email', [JoiningController, 'verifyEmail'])
    .as('api.joining.verify-email')

  router
    .put('/api/accounts/:accountId/members/:principalId/resource-link', [
      MemberResourcesController,
      'setLink',
    ])
    .as('api.member-resources.set')
  router
    .delete('/api/accounts/:accountId/members/:principalId/resource-link', [
      MemberResourcesController,
      'clearLink',
    ])
    .as('api.member-resources.clear')
  router
    .delete('/api/accounts/:accountId/members/:principalId/resource-link-exception', [
      MemberResourcesController,
      'clearException',
    ])
    .as('api.member-resources.clear-exception')
  router
    .get('/api/accounts/:accountId/resource-avatars', [MemberResourcesController, 'avatars'])
    .as('api.member-resources.avatars')
}
