import router from '@adonisjs/core/services/router';
import { asMember } from '#start/route_middleware';
import { middleware } from '#start/kernel';
import { controllers } from '#generated/controllers';

/** Registers the transfer controller endpoints. */
export function registerTransferRoutes() {
  router
    .group(() => {
      router
        .post('/api/transfer/preview', [controllers.Transfer, 'preview'])
        .as('api.transfer.preview')
        .use(asMember());
      router
        .post('/api/transfer/apply', [controllers.Transfer, 'apply'])
        .as('api.transfer.apply')
        .use(asMember());
    })
    .use(middleware.accountGate({ access: 'admitted' }));
}
