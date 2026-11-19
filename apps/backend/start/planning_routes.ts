import router from '@adonisjs/core/services/router';
import { asPlanningMember } from '#start/route_guards';
import { sensitive } from '@kevinjohn/adonisjs-masquerade/http';
const PlanningController = () => import('#controllers/planning_controller');

// Every planning route runs as the viewed-as member; the archive read is refused in view-as.
router
  .group(() => {
    router
      .get('/api/companies/:companyId/planning', [PlanningController, 'show'])
      .as('api.planning.show');
    router
      .get('/api/companies/:companyId/planning/archive', [PlanningController, 'archive'])
      .as('api.planning.archive')
      .use(sensitive());
    router
      .post('/api/companies/:companyId/planning/mutations', [PlanningController, 'mutate'])
      .as('api.planning.mutate');
    router
      .post('/api/companies/:companyId/planning/undo', [PlanningController, 'undo'])
      .as('api.planning.undo');
    router
      .post('/api/companies/:companyId/planning/redo', [PlanningController, 'redo'])
      .as('api.planning.redo');
  })
  .use(asPlanningMember());
