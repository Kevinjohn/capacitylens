import router from '@adonisjs/core/services/router';
import { asCompanyMember, asCompanyMemberOnly } from '#start/route_middleware';
import { middleware } from '#start/kernel';
import { controllers } from '#generated/controllers';

/** Registers company-scoped member administration and privacy routes. */
export function registerMembershipRoutes() {
  router
    .group(() => {
      router
        .get('/companies/:companyId/members', [controllers.Members, 'index'])
        .use(asCompanyMemberOnly());
      router
        .put('/companies/:companyId/member-sign-in-tracking', [
          controllers.MemberSignInTracking,
          'update',
        ])
        .use(asCompanyMember());
      router
        .patch('/companies/:companyId/members/:userId', [controllers.Members, 'update'])
        .use(asCompanyMember());
      router
        .patch('/companies/:companyId/members/:userId/status', [controllers.MemberStatus, 'update'])
        .use(asCompanyMember());
    })
    .use(middleware.accountGate({ access: 'admitted' }));
}
