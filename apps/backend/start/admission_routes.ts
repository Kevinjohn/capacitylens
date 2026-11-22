import router from '@adonisjs/core/services/router';
import {
  asCompanyMember,
  asCompanyMemberOnly,
  asMember,
  asMemberOnly,
  asOwnAccount,
} from '#start/route_middleware';
import { middleware } from '#start/kernel';
import { controllers } from '#generated/controllers';

/** Registers invitation, admission and member resource routes. */
export function registerAdmissionRoutes() {
  router
    .post('/api/invites', [controllers.Invitations, 'store'])
    .as('api.invites.create')
    .use([middleware.accountGate({ access: 'admitted' }), ...asMember()]);
  router
    .get('/api/companies/:companyId/invites', [controllers.Invitations, 'index'])
    .as('api.invites.index')
    .use([middleware.accountGate({ access: 'admitted' }), ...asCompanyMemberOnly()]);
  router
    .post('/api/companies/:companyId/invites/:id/resend', [
      controllers.InvitationDeliveries,
      'store',
    ])
    .as('api.invites.resend')
    .use([middleware.accountGate({ access: 'admitted' }), ...asCompanyMember()]);
  router
    .delete('/api/companies/:companyId/invites/:id', [controllers.Invitations, 'destroy'])
    .as('api.invites.revoke')
    .use([middleware.accountGate({ access: 'admitted' }), ...asCompanyMember()]);
  router
    .get('/api/invites/:token/preview', [controllers.InvitationLinks, 'show'])
    .as('api.invites.preview')
    .use(asOwnAccount());
  router
    .post('/api/invites/:token/signup', [controllers.InvitationAcceptances, 'store'])
    .as('api.invites.sign-up')
    .use(asOwnAccount());

  router
    .get('/api/admission', [controllers.Admission, 'show'])
    .as('api.admission.show')
    .use([middleware.accountGate({ access: 'limited' }), ...asMemberOnly()]);
  router
    .post('/api/admission/request', [controllers.AdmissionRequests, 'store'])
    .as('api.admission.request')
    .use([middleware.accountGate({ access: 'limited' }), ...asMember()]);
  router
    .post('/api/admission/complete', [controllers.Memberships, 'store'])
    .as('api.admission.complete')
    .use([middleware.accountGate({ access: 'admitted' }), ...asMember()]);
  router
    .get('/api/admission/requests', [controllers.AdmissionRequests, 'index'])
    .as('api.admission.index')
    .use([middleware.accountGate({ access: 'limited' }), ...asMemberOnly()]);
  router
    .post('/api/admission/:userId/approve', [controllers.AdmissionApprovals, 'store'])
    .as('api.admission.approve')
    .use([middleware.accountGate({ access: 'limited' }), ...asMember()]);
  router
    .post('/api/admission/:userId/reject', [controllers.AdmissionRejections, 'store'])
    .as('api.admission.reject')
    .use([middleware.accountGate({ access: 'limited' }), ...asMember()]);
  router
    .post('/api/admission/:userId/revoke', [controllers.AdmissionRevocations, 'store'])
    .as('api.admission.revoke')
    .use([middleware.accountGate({ access: 'limited' }), ...asMember()]);

  router
    .put('/api/companies/:companyId/members/:userId/resource-link', [
      controllers.MemberResourceLinks,
      'update',
    ])
    .as('api.member-resources.set')
    .use([middleware.accountGate({ access: 'admitted' }), ...asCompanyMember()]);
  router
    .delete('/api/companies/:companyId/members/:userId/resource-link', [
      controllers.MemberResourceLinks,
      'destroy',
    ])
    .as('api.member-resources.clear')
    .use([middleware.accountGate({ access: 'admitted' }), ...asCompanyMember()]);
}
