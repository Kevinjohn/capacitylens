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
    .group(() => {
      router.post('/invitations', [controllers.Invitations, 'store']).use(asMember());
      router
        .group(() => {
          router.get('/', [controllers.Invitations, 'index']).use(asCompanyMemberOnly());
          router
            .post('/:id/resend', [controllers.InvitationDeliveries, 'store'])
            .use(asCompanyMember());
          router.delete('/:id', [controllers.Invitations, 'destroy']).use(asCompanyMember());
        })
        .prefix('/companies/:companyId/invitations');
    })
    .use(middleware.accountGate({ access: 'admitted' }));
  router
    .group(() => {
      router.get('/preview', [controllers.InvitationLinks, 'show']);
      router.post('/sign-up', [controllers.InvitationAcceptances, 'store']);
    })
    .prefix('/invitations/:token')
    .use(asOwnAccount());

  router
    .group(() => {
      router
        .group(() => {
          router.get('/', [controllers.Admission, 'show']).use(asMemberOnly());
          router.post('/request', [controllers.AdmissionRequests, 'store']).use(asMember());
          router.get('/requests', [controllers.AdmissionRequests, 'index']).use(asMemberOnly());
          router
            .group(() => {
              router.post('/approve', [controllers.AdmissionApprovals, 'store']);
              router.post('/reject', [controllers.AdmissionRejections, 'store']);
              router.post('/revoke', [controllers.AdmissionRevocations, 'store']);
            })
            .prefix('/:userId')
            .use(asMember());
        })
        .use(middleware.accountGate({ access: 'limited' }));
      router
        .post('/complete', [controllers.Memberships, 'store'])
        .use([middleware.accountGate({ access: 'admitted' }), ...asMember()]);
    })
    .prefix('/admission');

  router
    .group(() => {
      router.put('/', [controllers.MemberResourceLinks, 'update']);
      router.delete('/', [controllers.MemberResourceLinks, 'destroy']);
    })
    .prefix('/companies/:companyId/members/:userId/resource-link')
    .use([middleware.accountGate({ access: 'admitted' }), ...asCompanyMember()]);
}
