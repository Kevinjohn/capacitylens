import router from '@adonisjs/core/services/router'

const InvitationsController = () => import('#controllers/invitations_controller')
const AdmissionController = () => import('#controllers/admission_controller')
const MemberResourcesController = () => import('#controllers/member_resources_controller')

/** Registers invitation, admission and member resource routes. */
export function registerAdmissionRoutes() {
  router.post('/api/invites', [InvitationsController, 'create']).as('api.invites.create')
  router
    .get('/api/accounts/:accountId/invites', [InvitationsController, 'index'])
    .as('api.invites.index')
  router
    .post('/api/accounts/:accountId/invites/:id/resend', [InvitationsController, 'resend'])
    .as('api.invites.resend')
  router
    .delete('/api/accounts/:accountId/invites/:id', [InvitationsController, 'revoke'])
    .as('api.invites.revoke')
  router
    .get('/api/invites/:token/preview', [InvitationsController, 'preview'])
    .as('api.invites.preview')
  router
    .post('/api/invites/:token/signup', [InvitationsController, 'signUp'])
    .as('api.invites.sign-up')

  router.get('/api/admission', [AdmissionController, 'show']).as('api.admission.show')
  router
    .post('/api/admission/request', [AdmissionController, 'request'])
    .as('api.admission.request')
  router
    .post('/api/admission/complete', [AdmissionController, 'complete'])
    .as('api.admission.complete')
  router.get('/api/admission/requests', [AdmissionController, 'index']).as('api.admission.index')
  router
    .post('/api/admission/:userId/approve', [AdmissionController, 'approve'])
    .as('api.admission.approve')
  router
    .post('/api/admission/:userId/reject', [AdmissionController, 'reject'])
    .as('api.admission.reject')
  router
    .post('/api/admission/:userId/revoke', [AdmissionController, 'revoke'])
    .as('api.admission.revoke')

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
    .get('/api/accounts/:accountId/resource-avatars', [MemberResourcesController, 'avatars'])
    .as('api.member-resources.avatars')
}
