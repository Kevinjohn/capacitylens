import router from '@adonisjs/core/services/router';
import { asMember, asMemberOnly, asOwnAccount } from '#start/route_guards';

const InvitationsController = () => import('#controllers/invitations_controller');
const AdmissionController = () => import('#controllers/admission_controller');
const MemberResourcesController = () => import('#controllers/member_resources_controller');

/** Registers invitation, admission and member resource routes. */
export function registerAdmissionRoutes() {
  router
    .post('/api/invites', [InvitationsController, 'create'])
    .as('api.invites.create')
    .use(asMember());
  router
    .get('/api/accounts/:accountId/invites', [InvitationsController, 'index'])
    .as('api.invites.index')
    .use(asMemberOnly());
  router
    .post('/api/accounts/:accountId/invites/:id/resend', [InvitationsController, 'resend'])
    .as('api.invites.resend')
    .use(asMember());
  router
    .delete('/api/accounts/:accountId/invites/:id', [InvitationsController, 'revoke'])
    .as('api.invites.revoke')
    .use(asMember());
  router
    .get('/api/invites/:token/preview', [InvitationsController, 'preview'])
    .as('api.invites.preview')
    .use(asOwnAccount());
  router
    .post('/api/invites/:token/signup', [InvitationsController, 'signUp'])
    .as('api.invites.sign-up')
    .use(asOwnAccount());

  router
    .get('/api/admission', [AdmissionController, 'show'])
    .as('api.admission.show')
    .use(asMemberOnly());
  router
    .post('/api/admission/request', [AdmissionController, 'request'])
    .as('api.admission.request')
    .use(asMember());
  router
    .post('/api/admission/complete', [AdmissionController, 'complete'])
    .as('api.admission.complete')
    .use(asMember());
  router
    .get('/api/admission/requests', [AdmissionController, 'index'])
    .as('api.admission.index')
    .use(asMemberOnly());
  router
    .post('/api/admission/:userId/approve', [AdmissionController, 'approve'])
    .as('api.admission.approve')
    .use(asMember());
  router
    .post('/api/admission/:userId/reject', [AdmissionController, 'reject'])
    .as('api.admission.reject')
    .use(asMember());
  router
    .post('/api/admission/:userId/revoke', [AdmissionController, 'revoke'])
    .as('api.admission.revoke')
    .use(asMember());

  router
    .put('/api/accounts/:accountId/members/:userId/resource-link', [
      MemberResourcesController,
      'setLink',
    ])
    .as('api.member-resources.set')
    .use(asMember());
  router
    .delete('/api/accounts/:accountId/members/:userId/resource-link', [
      MemberResourcesController,
      'clearLink',
    ])
    .as('api.member-resources.clear')
    .use(asMember());
  router
    .get('/api/accounts/:accountId/resource-avatars', [MemberResourcesController, 'avatars'])
    .as('api.member-resources.avatars')
    .use(asMemberOnly());
}
