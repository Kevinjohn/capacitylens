import router from '@adonisjs/core/services/router';
import { asCompanyMember } from '#start/route_guards';

const AnonymiseController = () => import('#controllers/anonymise_controller');

/** Registers the anonymise controller endpoints. */
export function registerAnonymiseRoutes() {
  router
    .post('/api/accounts/:accountId/anonymise', [AnonymiseController, 'company'])
    .as('api.accounts.anonymise')
    .use(asCompanyMember());
  router
    .post('/api/accounts/:accountId/resources/:id/anonymise', [AnonymiseController, 'resource'])
    .as('api.resources.anonymise')
    .use(asCompanyMember());
}
