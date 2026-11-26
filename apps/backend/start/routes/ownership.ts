import router from '@adonisjs/core/services/router';
import { apiPrefix } from '#start/api';
import { throttle } from '#start/limiter';
import { asCompanyMember } from '#start/route_middleware';
import { middleware } from '#start/kernel';
import { controllers } from '#generated/controllers';

// The atomic company ownership handover.
router
  .group(() => {
    router
      .group(() => {
        router
          .post('/companies/:companyId/ownership-transfer', [
            controllers.OwnershipTransfers,
            'store',
          ])
          .use(asCompanyMember());
      })
      .use(middleware.accountGate({ access: 'admitted' }));
  })
  .prefix(apiPrefix)
  .as('api')
  .use(throttle);
