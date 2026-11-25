import router from '@adonisjs/core/services/router';
import { throttle } from '#start/limiter';
import { asCompanyMember } from '#start/route_middleware';
import { middleware } from '#start/kernel';
import { controllers } from '#generated/controllers';

router
  .group(() => {
    router
      .group(() => {
        router
          .post('/companies/:companyId/example-data', [controllers.ExampleData, 'store'])
          .use(asCompanyMember());
      })
      .use(middleware.accountGate({ access: 'admitted' }));
  })
  .prefix('/api')
  .as('api')
  .use(throttle);
