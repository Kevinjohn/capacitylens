import router from '@adonisjs/core/services/router';
import { asMember } from '#start/route_guards';

const AnonymiseController = () => import('#controllers/anonymise_controller');

/** Registers the anonymise controller endpoints. */
export function registerAnonymiseRoutes() {
  router
    .post('/api/accounts/:accountId/anonymise', [AnonymiseController, 'company'])
    .as('api.accounts.anonymise')
    .use(asMember());
  router
    .post('/api/accounts/:accountId/resources/:id/anonymise', [AnonymiseController, 'resource'])
    .as('api.resources.anonymise')
    .use(asMember());
}
