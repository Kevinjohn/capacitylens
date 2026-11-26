import router from '@adonisjs/core/services/router';
import { throttle } from '#start/limiter';
import { asMember, asPlanningMember } from '#start/route_middleware';
import { middleware } from '#start/kernel';
import { controllers } from '#generated/controllers';

router
  .group(() => {
    router
      .group(() => {
        router.get('/state', [controllers.CompanyState, 'show']).use(asMember());
        router
          .get('/companies/:companyId/export', [controllers.CompanyExports, 'show'])
          .use(asPlanningMember());
      })
      .use(middleware.accountGate({ access: 'admitted' }));
  })
  .prefix('/api')
  .as('api')
  .use(throttle);
