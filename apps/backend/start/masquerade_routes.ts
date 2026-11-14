import router from '@adonisjs/core/services/router';
import { asSignedInPerson } from '#start/route_guards';

const MasqueradeController = () => import('#controllers/masquerade_controller');

export function registerMasqueradeRoutes() {
  router
    .post('/api/accounts/:accountId/masquerade', [MasqueradeController, 'start'])
    .as('api.masquerade.start')
    // The service compares the context token and refuses a second start itself, so a stale tab
    // gets MASQUERADE_CONTEXT_CHANGED rather than a blocker's MASQUERADE_READ_ONLY.
    .use(asSignedInPerson());
  router.get('/api/masquerade', [MasqueradeController, 'status']).as('api.masquerade.status');
  router
    .delete('/api/masquerade', [MasqueradeController, 'end'])
    .as('api.masquerade.end')
    .use(asSignedInPerson());
}
