import router from '@adonisjs/core/services/router';
import { asMember, asMemberOnly } from '#start/route_middleware';
import { controllers } from '#generated/controllers';

/** Registers the company controller endpoints. */
export function registerCompanyRoutes() {
  router
    .post('/api/installation/company', [controllers.FirstCompanySetup, 'store'])
    .as('api.installation.company')
    .use(asMember());
  router
    .get('/api/companies', [controllers.Companies, 'index'])
    .as('api.companies.index')
    .use(asMemberOnly());
}
