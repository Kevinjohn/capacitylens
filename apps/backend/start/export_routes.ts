import router from '@adonisjs/core/services/router';
import { asMember } from '#start/route_guards';

const ExportsController = () => import('#controllers/exports_controller');

/** Registers the export controller endpoints. */
export function registerExportRoutes() {
  router.get('/api/state', [ExportsController, 'show']).as('api.state').use(asMember());
}
