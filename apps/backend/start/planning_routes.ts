import router from '@adonisjs/core/services/router';
import { asPlanningMember } from '#start/route_middleware';
import { middleware } from '#start/kernel';
import { sensitive } from '@kevinjohn/adonisjs-masquerade/http';
import { controllers } from '#generated/controllers';

// Every planning route runs as the viewed-as member; the archive read is refused in view-as.
/** Registers the planning controller endpoints. */
export function registerPlanningRoutes() {
  router
    .group(() => {
      router
        .get('/api/companies/:companyId/planning', [controllers.Planning, 'show'])
        .as('api.planning.show');
      router
        .get('/api/companies/:companyId/planning/archive', [controllers.PlanningArchive, 'show'])
        .as('api.planning.archive')
        .use(sensitive());
      router
        .post('/api/companies/:companyId/planning/mutations', [
          controllers.PlanningMutations,
          'store',
        ])
        .as('api.planning.mutate');
      router
        .post('/api/companies/:companyId/planning/undo', [controllers.PlanningUndo, 'store'])
        .as('api.planning.undo');
      router
        .post('/api/companies/:companyId/planning/redo', [controllers.PlanningRedo, 'store'])
        .as('api.planning.redo');
    })
    .use([middleware.accountGate({ access: 'admitted' }), ...asPlanningMember()]);
}
