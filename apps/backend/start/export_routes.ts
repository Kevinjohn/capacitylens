import router from '@adonisjs/core/services/router';
import { asMember, asPlanningMember } from '#start/route_middleware';
import { middleware } from '#start/kernel';
import { controllers } from '#generated/controllers';

/** Registers the export controller endpoints. */
export function registerExportRoutes() {
  router
    .group(() => {
      router.get('/api/state', [controllers.Exports, 'show']).as('api.state').use(asMember());
      router
        .get('/api/companies/:companyId/export', [controllers.Exports, 'download'])
        .as('api.export')
        .use(asPlanningMember());
    })
    .use(middleware.accountGate({ access: 'admitted' }));
}
