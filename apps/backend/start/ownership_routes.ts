import router from '@adonisjs/core/services/router';
import { asCompanyMember } from '#start/route_guards';
import { controllers } from '#generated/controllers';

/** Registers the atomic company ownership handover. */
export function registerOwnershipRoutes() {
  router
    .post('/api/companies/:companyId/ownership-transfer', [controllers.Ownership, 'transfer'])
    .as('api.ownership.transfer')
    .use(asCompanyMember());
}
