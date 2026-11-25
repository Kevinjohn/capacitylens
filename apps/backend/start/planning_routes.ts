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
      router.get('/', [controllers.Planning, 'show']);
      router.get('/archive', [controllers.PlanningArchive, 'show']).use(sensitive());
      router.post('/mutations', [controllers.PlanningMutations, 'store']);
      router.post('/undo', [controllers.PlanningUndo, 'store']);
      router.post('/redo', [controllers.PlanningRedo, 'store']);
    })
    .prefix('/companies/:companyId/planning')
    .use([middleware.accountGate({ access: 'admitted' }), ...asPlanningMember()]);
}
