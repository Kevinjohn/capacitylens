import router from '@adonisjs/core/services/router';
import { asCompanyMember, asCompanyMemberOnly } from '#start/route_middleware';
import { middleware } from '#start/kernel';
import { controllers } from '#generated/controllers';

/** Registers company-scoped member administration and privacy routes. */
export function registerMembershipRoutes() {
  router
    .group(() => {
      router.get('/members', [controllers.Members, 'index']).use(asCompanyMemberOnly());
      router
        .group(() => {
          router.put('/member-sign-in-tracking', [controllers.MemberSignInTracking, 'update']);
          router.patch('/members/:userId', [controllers.Members, 'update']);
          router.patch('/members/:userId/status', [controllers.MemberStatus, 'update']);
        })
        .use(asCompanyMember());
    })
    .prefix('/companies/:companyId')
    .use(middleware.accountGate({ access: 'admitted' }));
}
