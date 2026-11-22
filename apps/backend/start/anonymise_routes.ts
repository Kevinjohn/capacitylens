import router from '@adonisjs/core/services/router';
import { asCompanyMember } from '#start/route_middleware';
import { middleware } from '#start/kernel';
import { controllers } from '#generated/controllers';

/** Registers the anonymise controller endpoints. */
export function registerAnonymiseRoutes() {
  router
    .group(() => {
      router
        .post('/companies/:companyId/anonymise', [controllers.CompanyAnonymisations, 'store'])
        .use(asCompanyMember());
      router
        .post('/companies/:companyId/resources/:id/anonymise', [
          controllers.ResourceAnonymisations,
          'store',
        ])
        .use(asCompanyMember());
    })
    .use(middleware.accountGate({ access: 'admitted' }));
}
