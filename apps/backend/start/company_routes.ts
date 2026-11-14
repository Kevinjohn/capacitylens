import router from '@adonisjs/core/services/router';
import { asMember, asMemberOnly } from '#start/route_guards';

const FirstCompanySetupController = () => import('#controllers/first_company_setup_controller');
const CompaniesController = () => import('#controllers/companies_controller');

/** Registers the company controller endpoints. */
export function registerCompanyRoutes() {
  router
    .post('/api/installation/company', [FirstCompanySetupController, 'store'])
    .as('api.installation.company')
    .use(asMember());
  router
    .get('/api/accounts', [CompaniesController, 'index'])
    .as('api.accounts.index')
    .use(asMemberOnly());
}
