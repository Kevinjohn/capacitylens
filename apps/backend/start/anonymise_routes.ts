import router from '@adonisjs/core/services/router';

const AnonymiseController = () => import('#controllers/anonymise_controller');

/** Registers the anonymise controller endpoints. */
export function registerAnonymiseRoutes() {
  router
    .post('/api/accounts/:accountId/anonymise', [AnonymiseController, 'company'])
    .as('api.accounts.anonymise');
  router
    .post('/api/accounts/:accountId/resources/:id/anonymise', [AnonymiseController, 'resource'])
    .as('api.resources.anonymise');
}
