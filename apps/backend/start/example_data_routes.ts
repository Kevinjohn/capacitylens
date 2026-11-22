import router from '@adonisjs/core/services/router';
import { asCompanyMember } from '#start/route_middleware';
import { middleware } from '#start/kernel';
import { controllers } from '#generated/controllers';

/** Registers the example data controller endpoints. */
export function registerExampleDataRoutes() {
  router
    .group(() => {
      router
        .post('/companies/:companyId/example-data', [controllers.ExampleData, 'store'])
        .use(asCompanyMember());
    })
    .use(middleware.accountGate({ access: 'admitted' }));
}
