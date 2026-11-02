import router from '@adonisjs/core/services/router';

const ExampleDataController = () => import('#controllers/example_data_controller');

/** Registers the example data controller endpoints. */
export function registerExampleDataRoutes() {
  router
    .post('/api/accounts/:accountId/example-data', [ExampleDataController, 'store'])
    .as('api.example-data');
}
