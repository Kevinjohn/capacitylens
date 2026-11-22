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
      router.get('/companies/:companyId/planning', [controllers.Planning, 'show']);
      router
        .get('/companies/:companyId/planning/archive', [controllers.PlanningArchive, 'show'])
        .use(sensitive());
      router.post('/companies/:companyId/planning/mutations', [
        controllers.PlanningMutations,
        'store',
      ]);
      router.post('/companies/:companyId/planning/undo', [controllers.PlanningUndo, 'store']);
      router.post('/companies/:companyId/planning/redo', [controllers.PlanningRedo, 'store']);
    })
    .use([middleware.accountGate({ access: 'admitted' }), ...asPlanningMember()]);
}
