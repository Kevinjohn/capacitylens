import router from '@adonisjs/core/services/router';
import { asMember } from '#start/route_middleware';
import { middleware } from '#start/kernel';
import { controllers } from '#generated/controllers';

/** Registers the transfer controller endpoints. */
export function registerTransferRoutes() {
  router
    .group(() => {
      router
        .post('/api/transfer/preview', [controllers.ImportPreviews, 'store'])
        .as('api.transfer.preview')
        .use(asMember());
      router
        .post('/api/transfer/apply', [controllers.Imports, 'store'])
        .as('api.transfer.apply')
        .use(asMember());
    })
    .use(middleware.accountGate({ access: 'admitted' }));
}
