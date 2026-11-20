import router from '@adonisjs/core/services/router';
import {
  asCompanyMember,
  asCompanyMemberOnly,
  asMember,
  asMemberOnly,
  asOwnAccount,
} from '#start/route_guards';
import { controllers } from '#generated/controllers';

/** Registers invitation, admission and member resource routes. */
export function registerAdmissionRoutes() {
  router
    .post('/api/invites', [controllers.Invitations, 'create'])
    .as('api.invites.create')
    .use(asMember());
  router
    .get('/api/companies/:companyId/invites', [controllers.Invitations, 'index'])
    .as('api.invites.index')
    .use(asCompanyMemberOnly());
  router
    .post('/api/companies/:companyId/invites/:id/resend', [controllers.Invitations, 'resend'])
    .as('api.invites.resend')
    .use(asCompanyMember());
  router
    .delete('/api/companies/:companyId/invites/:id', [controllers.Invitations, 'revoke'])
    .as('api.invites.revoke')
    .use(asCompanyMember());
  router
    .get('/api/invites/:token/preview', [controllers.Invitations, 'preview'])
    .as('api.invites.preview')
    .use(asOwnAccount());
  router
    .post('/api/invites/:token/signup', [controllers.Invitations, 'signUp'])
    .as('api.invites.sign-up')
    .use(asOwnAccount());

  router
    .get('/api/admission', [controllers.Admission, 'show'])
    .as('api.admission.show')
    .use(asMemberOnly());
  router
    .post('/api/admission/request', [controllers.Admission, 'request'])
    .as('api.admission.request')
    .use(asMember());
  router
    .post('/api/admission/complete', [controllers.Admission, 'complete'])
    .as('api.admission.complete')
    .use(asMember());
  router
    .get('/api/admission/requests', [controllers.Admission, 'index'])
    .as('api.admission.index')
    .use(asMemberOnly());
  router
    .post('/api/admission/:userId/approve', [controllers.Admission, 'approve'])
    .as('api.admission.approve')
    .use(asMember());
  router
    .post('/api/admission/:userId/reject', [controllers.Admission, 'reject'])
    .as('api.admission.reject')
    .use(asMember());
  router
    .post('/api/admission/:userId/revoke', [controllers.Admission, 'revoke'])
    .as('api.admission.revoke')
    .use(asMember());

  router
    .put('/api/companies/:companyId/members/:userId/resource-link', [
      controllers.MemberResources,
      'setLink',
    ])
    .as('api.member-resources.set')
    .use(asCompanyMember());
  router
    .delete('/api/companies/:companyId/members/:userId/resource-link', [
      controllers.MemberResources,
      'clearLink',
    ])
    .as('api.member-resources.clear')
    .use(asCompanyMember());
}
