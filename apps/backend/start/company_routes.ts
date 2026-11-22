import router from '@adonisjs/core/services/router';
import { asMember, asMemberOnly } from '#start/route_middleware';
import { middleware } from '#start/kernel';
import { controllers } from '#generated/controllers';

/** Registers the company controller endpoints. */
export function registerCompanyRoutes() {
  router
    .group(() => {
      router
        .post('/installation/company', [controllers.FirstCompanySetup, 'store'])
        .use(asMember());
      router.get('/companies', [controllers.Companies, 'index']).use(asMemberOnly());
    })
    .use(middleware.accountGate({ access: 'admitted' }));
}
