import env from '#start/env'
import router from '@adonisjs/core/services/router'
import { checkDatabase, readState, resetState } from '#services/state_repository'
import { fileURLToPath } from 'node:url'
import { healthChecks } from '#start/health'
import { reportCspViolation } from '#services/csp_report'
import { middleware } from '#start/kernel'
import { registerAuthRoutes } from '#start/auth_routes'
import { registerMembershipRoutes } from '#start/membership_routes'
import { registerAdmissionRoutes } from '#start/admission_routes'
import { registerMasqueradeRoutes } from '#start/masquerade_routes'
import { registerOwnershipRoutes } from '#start/ownership_routes'
import { registerGoogleRoutes } from '#start/google_routes'

const BatchController = () => import('#controllers/batch_controller')
const LifecycleController = () => import('#controllers/lifecycle_controller')
const ImportsController = () => import('#controllers/imports_controller')
const ExportsController = () => import('#controllers/exports_controller')
const ExampleDataController = () => import('#controllers/example_data_controller')
const GettingStartedController = () => import('#controllers/getting_started_controller')
const CompaniesController = () => import('#controllers/companies_controller')

router.post('/api/batch', [BatchController, 'store']).use(middleware.bodyLimits()).as('api.batch')
router
  .post('/api/import', [ImportsController, 'store'])
  .use(middleware.bodyLimits())
  .as('api.import')
router.get('/api/state', [ExportsController, 'show']).as('api.state')
router.post('/api/orgs', [CompaniesController, 'storeOrg']).as('api.orgs.store')
router.post('/api/accounts', [CompaniesController, 'store']).as('api.accounts.store')
router.patch('/api/accounts/:id', [CompaniesController, 'update']).as('api.accounts.update')
router.delete('/api/accounts/:id', [CompaniesController, 'destroy']).as('api.accounts.destroy')
router
  .post('/api/accounts/:accountId/example-data', [ExampleDataController, 'store'])
  .as('api.example-data')
router
  .get('/api/accounts/:accountId/getting-started', [GettingStartedController, 'show'])
  .as('api.getting-started.show')
router
  .put('/api/accounts/:accountId/getting-started', [GettingStartedController, 'update'])
  .as('api.getting-started.update')
registerAuthRoutes()
registerMembershipRoutes()
registerAdmissionRoutes()
registerMasqueradeRoutes()
registerOwnershipRoutes()
registerGoogleRoutes()
router.post('/api/:entity/:id/:action', [LifecycleController, 'mutate']).as('api.lifecycle')

router.get('/api/health', () => ({ ok: true })).as('api.health')
router.get('/health/live', () => ({ ok: true }))
router.get('/health/ready', async ({ response }) => {
  try {
    const report = await healthChecks.run()
    if (!report.isHealthy) return response.serviceUnavailable(report)
    await checkDatabase()
    return response.ok(report)
  } catch {
    return response.serviceUnavailable({ isHealthy: false, status: 'error', checks: [] })
  }
})
router.get('/api/meta', async () => {
  const state = await readState()
  return { hasData: state.accounts.length > 0 }
})
router.get('/api/diagnostics', async ({ response }) => {
  try {
    await checkDatabase()
    return {
      server: {
        connectivity: 'ok',
        database: { status: 'ok', schemaVersion: 4 },
        persistence: 'unknown',
        backup: { status: 'unavailable', lastSuccessAt: null },
      },
    }
  } catch {
    return response.serviceUnavailable({
      server: {
        connectivity: 'ok',
        database: { status: 'unavailable', schemaVersion: null },
        persistence: 'unknown',
        backup: { status: 'unavailable', lastSuccessAt: null },
      },
    })
  }
})
router.get('/api/accounts', [CompaniesController, 'index']).as('api.accounts.index')
router.post('/api/security/csp-report', ({ request, response, logger }) => {
  const event = reportCspViolation(request.body())
  if (event) logger.info(event, 'CSP violation reported')
  return response.noContent()
})
router.post('/api/test/reset', async ({ request, response }) => {
  if (!env.get('CAPACITYLENS_ALLOW_RESET'))
    return response.forbidden({ error: 'Reset is disabled.' })
  const body = request.body() as unknown
  if (
    body !== undefined &&
    (body === null ||
      typeof body !== 'object' ||
      Array.isArray(body) ||
      Object.keys(body).some((key) => key !== 'seed') ||
      ('seed' in body && typeof body.seed !== 'boolean'))
  )
    return response.badRequest({ error: 'Invalid reset request.' })
  await resetState(body !== undefined && 'seed' in body ? body.seed === true : false)
  return { ok: true }
})
router.get('*', async ({ request, response }) => {
  const path = request.url().split('?', 1)[0] ?? request.url()
  if (path.startsWith('/api/')) return response.notFound({ error: 'Not found' })
  const lastSegment = path.split('/').at(-1) ?? ''
  if (
    path.startsWith('/assets/') ||
    (path !== '/' && path.endsWith('/')) ||
    lastSegment.includes('.')
  )
    return response.notFound('Not found')
  response.header('Cache-Control', 'no-store')
  return response.download(fileURLToPath(new URL('../public/index.html', import.meta.url)))
})
