import router from '@adonisjs/core/services/router';
import { asMember } from '#start/route_middleware';
import { middleware } from '#start/kernel';
import { controllers } from '#generated/controllers';

/** Registers the import preview and apply endpoints. */
export function registerImportRoutes() {
  router
    .group(() => {
      router.post('/import/preview', [controllers.ImportPreviews, 'store']).use(asMember());
      router.post('/import/apply', [controllers.Imports, 'store']).use(asMember());
    })
    .use(middleware.accountGate({ access: 'admitted' }));
}
