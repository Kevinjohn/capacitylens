import router from '@adonisjs/core/services/router';
import { asMember, asMemberOnly } from '#start/route_guards';

const MembersController = () => import('#controllers/members_controller');

/** Registers company-scoped member administration and privacy routes. */
export function registerMembershipRoutes() {
  router
    .get('/api/accounts/:accountId/members', [MembersController, 'index'])
    .as('api.members.index')
    .use(asMemberOnly());
  router
    .put('/api/accounts/:accountId/member-sign-in-tracking', [MembersController, 'tracking'])
    .as('api.members.tracking')
    .use(asMember());
  router
    .patch('/api/accounts/:accountId/members/:userId', [MembersController, 'changeRole'])
    .as('api.members.role')
    .use(asMember());
  router
    .patch('/api/accounts/:accountId/members/:userId/status', [MembersController, 'changeStatus'])
    .as('api.members.status')
    .use(asMember());
}
