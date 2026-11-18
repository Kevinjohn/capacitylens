import router from '@adonisjs/core/services/router';
import { asCompanyMember, asCompanyMemberOnly } from '#start/route_guards';

const MembersController = () => import('#controllers/members_controller');

/** Registers company-scoped member administration and privacy routes. */
export function registerMembershipRoutes() {
  router
    .get('/api/companies/:companyId/members', [MembersController, 'index'])
    .as('api.members.index')
    .use(asCompanyMemberOnly());
  router
    .put('/api/companies/:companyId/member-sign-in-tracking', [MembersController, 'tracking'])
    .as('api.members.tracking')
    .use(asCompanyMember());
  router
    .patch('/api/companies/:companyId/members/:userId', [MembersController, 'changeRole'])
    .as('api.members.role')
    .use(asCompanyMember());
  router
    .patch('/api/companies/:companyId/members/:userId/status', [MembersController, 'changeStatus'])
    .as('api.members.status')
    .use(asCompanyMember());
}
