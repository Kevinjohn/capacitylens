import router from '@adonisjs/core/services/router';
import { throttle } from '#start/limiter';
import { asCompanyMember, asCompanyMemberOnly } from '#start/route_middleware';
import { middleware } from '#start/kernel';
import { controllers } from '#generated/controllers';

router
  .group(() => {
    router
      .group(() => {
        router.get('/', [controllers.GettingStarted, 'show']).use(asCompanyMemberOnly());
        router.put('/', [controllers.GettingStarted, 'update']).use(asCompanyMember());
      })
      .prefix('/companies/:companyId/getting-started')
      .use(middleware.accountGate({ access: 'admitted' }));
  })
  .prefix('/api')
  .as('api')
  .use(throttle);
