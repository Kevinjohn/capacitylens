import router from '@adonisjs/core/services/router';
import { asCompanyMember } from '#start/route_middleware';
import { middleware } from '#start/kernel';
import { controllers } from '#generated/controllers';

/** Registers the anonymise controller endpoints. */
export function registerAnonymiseRoutes() {
  router
    .group(() => {
      router
        .post('/api/companies/:companyId/anonymise', [controllers.Anonymise, 'company'])
        .as('api.companies.anonymise')
        .use(asCompanyMember());
      router
        .post('/api/companies/:companyId/resources/:id/anonymise', [
          controllers.Anonymise,
          'resource',
        ])
        .as('api.resources.anonymise')
        .use(asCompanyMember());
    })
    .use(middleware.accountGate({ access: 'admitted' }));
}
