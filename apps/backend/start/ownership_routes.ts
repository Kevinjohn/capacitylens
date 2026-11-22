import router from '@adonisjs/core/services/router';
import { asCompanyMember } from '#start/route_middleware';
import { middleware } from '#start/kernel';
import { controllers } from '#generated/controllers';

/** Registers the atomic company ownership handover. */
export function registerOwnershipRoutes() {
  router
    .group(() => {
      router
        .post('/companies/:companyId/ownership-transfer', [controllers.OwnershipTransfers, 'store'])
        .use(asCompanyMember());
    })
    .use(middleware.accountGate({ access: 'admitted' }));
}
