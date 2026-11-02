import router from '@adonisjs/core/services/router';

const GettingStartedController = () => import('#controllers/getting_started_controller');

/** Registers the getting started controller endpoints. */
export function registerGettingStartedRoutes() {
  router
    .get('/api/accounts/:accountId/getting-started', [GettingStartedController, 'show'])
    .as('api.getting-started.show');
  router
    .put('/api/accounts/:accountId/getting-started', [GettingStartedController, 'update'])
    .as('api.getting-started.update');
}
