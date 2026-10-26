import router from '@adonisjs/core/services/router'

const ExportsController = () => import('#controllers/exports_controller')

/** Registers the export controller endpoints. */
export function registerExportRoutes() {
  router.get('/api/state', [ExportsController, 'show']).as('api.state')
}
