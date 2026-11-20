import router from '@adonisjs/core/services/router';
import { asMemberOnly } from '#start/route_guards';
import { controllers } from '#generated/controllers';

/** Registers the diagnostics controller endpoint. */
export function registerDiagnosticsRoutes() {
  router
    .get('/api/diagnostics', [controllers.Diagnostics, 'show'])
    .as('api.diagnostics')
    .use(asMemberOnly());
}
