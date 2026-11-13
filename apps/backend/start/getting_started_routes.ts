import router from '@adonisjs/core/services/router';
import { asMember, asMemberOnly } from '#start/route_guards';

const GettingStartedController = () => import('#controllers/getting_started_controller');

/** Registers the getting started controller endpoints. */
export function registerGettingStartedRoutes() {
  router
    .get('/api/accounts/:accountId/getting-started', [GettingStartedController, 'show'])
    .as('api.getting-started.show')
    .use(asMemberOnly());
  router
    .put('/api/accounts/:accountId/getting-started', [GettingStartedController, 'update'])
    .as('api.getting-started.update')
    .use(asMember());
}
