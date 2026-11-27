import router from '@adonisjs/core/services/router';
import { apiPrefix } from '#start/api';
import { throttle } from '#start/limiter';
import { asCompanySignedInPerson, asSignedInPerson } from '#start/route_middleware';
import { middleware } from '#start/kernel';
import { controllers } from '#generated/controllers';

router
  .group(() => {
    router
      .group(() => {
        // The service compares the context token and refuses a second start itself, so a stale tab
        // gets E_MASQUERADE_CONTEXT_CHANGED rather than a blocker's E_MASQUERADE_READ_ONLY.
        router
          .post('/companies/:companyId/masquerade', [controllers.Masquerade, 'store'])
          .use(asCompanySignedInPerson());
        router.delete('/masquerade', [controllers.Masquerade, 'destroy']).use(asSignedInPerson());
      })
      .use(middleware.accountGate({ access: 'limited' }));
    router.get('/masquerade', [controllers.Masquerade, 'show']);
  })
  .prefix(apiPrefix)
  .as('api')
  .use(throttle);
