import router from '@adonisjs/core/services/router';
import { asMember } from '#start/route_middleware';
import { middleware } from '#start/kernel';
import { controllers } from '#generated/controllers';

/** Registers the transfer controller endpoints. */
export function registerTransferRoutes() {
  router
    .group(() => {
      router.post('/transfer/preview', [controllers.ImportPreviews, 'store']).use(asMember());
      router.post('/transfer/apply', [controllers.Imports, 'store']).use(asMember());
    })
    .use(middleware.accountGate({ access: 'admitted' }));
}
