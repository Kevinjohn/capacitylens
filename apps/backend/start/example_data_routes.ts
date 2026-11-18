import router from '@adonisjs/core/services/router';
import { asCompanyMember } from '#start/route_guards';

const ExampleDataController = () => import('#controllers/example_data_controller');

/** Registers the example data controller endpoints. */
export function registerExampleDataRoutes() {
  router
    .post('/api/companies/:companyId/example-data', [ExampleDataController, 'store'])
    .as('api.example-data')
    .use(asCompanyMember());
}
