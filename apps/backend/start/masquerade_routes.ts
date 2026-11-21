import router from '@adonisjs/core/services/router';
import { asCompanySignedInPerson, asSignedInPerson } from '#start/route_middleware';
import { middleware } from '#start/kernel';
import { controllers } from '#generated/controllers';

export function registerMasqueradeRoutes() {
  router
    .post('/api/companies/:companyId/masquerade', [controllers.Masquerade, 'start'])
    .as('api.masquerade.start')
    // The service compares the context token and refuses a second start itself, so a stale tab
    // gets MASQUERADE_CONTEXT_CHANGED rather than a blocker's MASQUERADE_READ_ONLY.
    .use([middleware.accountGate({ access: 'limited' }), ...asCompanySignedInPerson()]);
  router.get('/api/masquerade', [controllers.Masquerade, 'status']).as('api.masquerade.status');
  router
    .delete('/api/masquerade', [controllers.Masquerade, 'end'])
    .as('api.masquerade.end')
    .use([middleware.accountGate({ access: 'limited' }), ...asSignedInPerson()]);
}
