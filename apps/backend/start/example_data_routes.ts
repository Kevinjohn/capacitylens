import router from '@adonisjs/core/services/router';
import { asCompanyMember } from '#start/route_guards';
import { controllers } from '#generated/controllers';

/** Registers the example data controller endpoints. */
export function registerExampleDataRoutes() {
  router
    .post('/api/companies/:companyId/example-data', [controllers.ExampleData, 'store'])
    .as('api.example-data')
    .use(asCompanyMember());
}
