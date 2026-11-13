import router from '@adonisjs/core/services/router';

const DiagnosticsController = () => import('#controllers/diagnostics_controller');

/** Registers the diagnostics controller endpoint. */
export function registerDiagnosticsRoutes() {
  router.get('/api/diagnostics', [DiagnosticsController, 'show']).as('api.diagnostics');
}
