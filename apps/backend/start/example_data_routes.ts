import router from '@adonisjs/core/services/router';
import { asMember } from '#start/route_guards';

const ExampleDataController = () => import('#controllers/example_data_controller');

/** Registers the example data controller endpoints. */
export function registerExampleDataRoutes() {
  router
    .post('/api/accounts/:accountId/example-data', [ExampleDataController, 'store'])
    .as('api.example-data')
    .use(asMember());
}
