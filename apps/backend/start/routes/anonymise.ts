import router from '@adonisjs/core/services/router';
import { throttle } from '#start/limiter';
import { asCompanyMember } from '#start/route_middleware';
import { middleware } from '#start/kernel';
import { controllers } from '#generated/controllers';

router
  .group(() => {
    router
      .group(() => {
        router.post('/anonymise', [controllers.CompanyAnonymisations, 'store']);
        router.post('/resources/:id/anonymise', [controllers.ResourceAnonymisations, 'store']);
      })
      .prefix('/companies/:companyId')
      .use([middleware.accountGate({ access: 'admitted' }), ...asCompanyMember()]);
  })
  .prefix('/api')
  .as('api')
  .use(throttle);
