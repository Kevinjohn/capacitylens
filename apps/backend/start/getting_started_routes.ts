import router from '@adonisjs/core/services/router';
import { asCompanyMember, asCompanyMemberOnly } from '#start/route_middleware';
import { middleware } from '#start/kernel';
import { controllers } from '#generated/controllers';

/** Registers the getting started controller endpoints. */
export function registerGettingStartedRoutes() {
  router
    .group(() => {
      router
        .get('/companies/:companyId/getting-started', [controllers.GettingStarted, 'show'])
        .use(asCompanyMemberOnly());
      router
        .put('/companies/:companyId/getting-started', [controllers.GettingStarted, 'update'])
        .use(asCompanyMember());
    })
    .use(middleware.accountGate({ access: 'admitted' }));
}
