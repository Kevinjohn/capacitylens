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
    .post('/invitations', [controllers.Invitations, 'store'])
    .use([middleware.accountGate({ access: 'admitted' }), ...asMember()]);
  router
    .get('/companies/:companyId/invitations', [controllers.Invitations, 'index'])
    .use([middleware.accountGate({ access: 'admitted' }), ...asCompanyMemberOnly()]);
  router
    .post('/companies/:companyId/invitations/:id/resend', [
      controllers.InvitationDeliveries,
      'store',
    ])
    .use([middleware.accountGate({ access: 'admitted' }), ...asCompanyMember()]);
  router
    .delete('/companies/:companyId/invitations/:id', [controllers.Invitations, 'destroy'])
    .use([middleware.accountGate({ access: 'admitted' }), ...asCompanyMember()]);
  router
    .get('/invitations/:token/preview', [controllers.InvitationLinks, 'show'])
    .use(asOwnAccount());
  router
    .post('/invitations/:token/sign-up', [controllers.InvitationAcceptances, 'store'])
    .use(asOwnAccount());

  router
    .get('/admission', [controllers.Admission, 'show'])
    .use([middleware.accountGate({ access: 'limited' }), ...asMemberOnly()]);
  router
    .post('/admission/request', [controllers.AdmissionRequests, 'store'])
    .use([middleware.accountGate({ access: 'limited' }), ...asMember()]);
  router
    .post('/admission/complete', [controllers.Memberships, 'store'])
    .use([middleware.accountGate({ access: 'admitted' }), ...asMember()]);
  router
    .get('/admission/requests', [controllers.AdmissionRequests, 'index'])
    .use([middleware.accountGate({ access: 'limited' }), ...asMemberOnly()]);
  router
    .post('/admission/:userId/approve', [controllers.AdmissionApprovals, 'store'])
    .use([middleware.accountGate({ access: 'limited' }), ...asMember()]);
  router
    .post('/admission/:userId/reject', [controllers.AdmissionRejections, 'store'])
    .use([middleware.accountGate({ access: 'limited' }), ...asMember()]);
  router
    .post('/admission/:userId/revoke', [controllers.AdmissionRevocations, 'store'])
    .use([middleware.accountGate({ access: 'limited' }), ...asMember()]);

  router
    .put('/companies/:companyId/members/:userId/resource-link', [
      controllers.MemberResourceLinks,
      'update',
    ])
    .use([middleware.accountGate({ access: 'admitted' }), ...asCompanyMember()]);
  router
    .delete('/companies/:companyId/members/:userId/resource-link', [
      controllers.MemberResourceLinks,
      'destroy',
    ])
    .use([middleware.accountGate({ access: 'admitted' }), ...asCompanyMember()]);
}
