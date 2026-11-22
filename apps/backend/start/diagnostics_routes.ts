import router from '@adonisjs/core/services/router';
import { asMemberOnly } from '#start/route_middleware';
import { middleware } from '#start/kernel';
import { controllers } from '#generated/controllers';

/** Registers the diagnostics controller endpoint. */
export function registerDiagnosticsRoutes() {
  router
    .group(() => {
      router.get('/diagnostics', [controllers.Diagnostics, 'show']).use(asMemberOnly());
    })
    .use(middleware.accountGate({ access: 'admitted' }));
}
