import router from '@adonisjs/core/services/router';
import { asCompanyMember, asCompanyMemberOnly } from '#start/route_middleware';
import { middleware } from '#start/kernel';
import { controllers } from '#generated/controllers';

/** Registers the getting started controller endpoints. */
export function registerGettingStartedRoutes() {
  router
    .group(() => {
      router
        .get('/api/companies/:companyId/getting-started', [controllers.GettingStarted, 'show'])
        .as('api.getting-started.show')
        .use(asCompanyMemberOnly());
      router
        .put('/api/companies/:companyId/getting-started', [controllers.GettingStarted, 'update'])
        .as('api.getting-started.update')
        .use(asCompanyMember());
    })
    .use(middleware.accountGate({ access: 'admitted' }));
}
