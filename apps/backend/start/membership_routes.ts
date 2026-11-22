import router from '@adonisjs/core/services/router';
import { asCompanyMember, asCompanyMemberOnly } from '#start/route_middleware';
import { middleware } from '#start/kernel';
import { controllers } from '#generated/controllers';

/** Registers company-scoped member administration and privacy routes. */
export function registerMembershipRoutes() {
  router
    .group(() => {
      router
        .get('/api/companies/:companyId/members', [controllers.Members, 'index'])
        .as('api.members.index')
        .use(asCompanyMemberOnly());
      router
        .put('/api/companies/:companyId/member-sign-in-tracking', [
          controllers.MemberSignInTracking,
          'update',
        ])
        .as('api.members.tracking')
        .use(asCompanyMember());
      router
        .patch('/api/companies/:companyId/members/:userId', [controllers.Members, 'update'])
        .as('api.members.role')
        .use(asCompanyMember());
      router
        .patch('/api/companies/:companyId/members/:userId/status', [
          controllers.MemberStatus,
          'update',
        ])
        .as('api.members.status')
        .use(asCompanyMember());
    })
    .use(middleware.accountGate({ access: 'admitted' }));
}
