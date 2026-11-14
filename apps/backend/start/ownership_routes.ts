import router from '@adonisjs/core/services/router';
import { asMember } from '#start/route_guards';

const OwnershipController = () => import('#controllers/ownership_controller');

/** Registers the atomic company ownership handover. */
export function registerOwnershipRoutes() {
  router
    .post('/api/accounts/:accountId/ownership-transfer', [OwnershipController, 'transfer'])
    .as('api.ownership.transfer')
    .use(asMember());
}
