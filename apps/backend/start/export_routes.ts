import router from '@adonisjs/core/services/router';
import { asMember, asPlanningMember } from '#start/route_middleware';
import { middleware } from '#start/kernel';
import { controllers } from '#generated/controllers';

/** Registers the export controller endpoints. */
export function registerExportRoutes() {
  router
    .group(() => {
      router.get('/state', [controllers.CompanyState, 'show']).use(asMember());
      router
        .get('/companies/:companyId/export', [controllers.CompanyExports, 'show'])
        .use(asPlanningMember());
    })
    .use(middleware.accountGate({ access: 'admitted' }));
}
