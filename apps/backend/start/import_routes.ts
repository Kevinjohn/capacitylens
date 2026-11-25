import router from '@adonisjs/core/services/router';
import { asMember } from '#start/route_middleware';
import { middleware } from '#start/kernel';
import { controllers } from '#generated/controllers';

/** Registers the import preview and apply endpoints. */
export function registerImportRoutes() {
  router
    .group(() => {
      router.post('/preview', [controllers.ImportPreviews, 'store']);
      router.post('/apply', [controllers.Imports, 'store']);
    })
    .prefix('/import')
    .use([middleware.accountGate({ access: 'admitted' }), ...asMember()]);
}
