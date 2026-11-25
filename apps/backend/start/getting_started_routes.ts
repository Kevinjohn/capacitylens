import router from '@adonisjs/core/services/router';
import { asCompanyMember, asCompanyMemberOnly } from '#start/route_middleware';
import { middleware } from '#start/kernel';
import { controllers } from '#generated/controllers';

/** Registers the getting started controller endpoints. */
export function registerGettingStartedRoutes() {
  router
    .group(() => {
      router.get('/', [controllers.GettingStarted, 'show']).use(asCompanyMemberOnly());
      router.put('/', [controllers.GettingStarted, 'update']).use(asCompanyMember());
    })
    .prefix('/companies/:companyId/getting-started')
    .use(middleware.accountGate({ access: 'admitted' }));
}
