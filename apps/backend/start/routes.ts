import '#start/planning_routes'
import env from '#start/env'
import db from '@adonisjs/lucid/services/db'
import { statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { listSnapshots, type FileIdentity } from '#services/backup/retention'
import router from '@adonisjs/core/services/router'
import { checkDatabase, readState, resetState } from '#services/state_repository'
import { resolveCurrentActor } from '#services/auth/session_authority'
import { activeCompanyRole } from '#services/auth/authorization'
import { withTransaction } from '#services/with_transaction'
import { fileURLToPath } from 'node:url'
import { healthChecks } from '#start/health'
import { registerAuthRoutes } from '#start/auth_routes'
import { registerMembershipRoutes } from '#start/membership_routes'
import { registerAdmissionRoutes } from '#start/admission_routes'
import { registerMasqueradeRoutes } from '#start/masquerade_routes'
import { registerOwnershipRoutes } from '#start/ownership_routes'
import { registerGoogleRoutes } from '#start/google_routes'

const AnonymiseController = () => import('#controllers/anonymise_controller')
const TransferController = () => import('#controllers/transfer_controller')
const ExportsController = () => import('#controllers/exports_controller')
const ExampleDataController = () => import('#controllers/example_data_controller')
const GettingStartedController = () => import('#controllers/getting_started_controller')
const FirstCompanySetupController = () => import('#controllers/first_company_setup_controller')

router
  .post('/api/installation/company', [FirstCompanySetupController, 'store'])
  .as('api.installation.company')

const CompaniesController = () => import('#controllers/companies_controller')

router.post('/api/transfer/preview', [TransferController, 'preview']).as('api.transfer.preview')
router.post('/api/transfer/apply', [TransferController, 'apply']).as('api.transfer.apply')
router.get('/api/state', [ExportsController, 'show']).as('api.state')
router
  .post('/api/accounts/:accountId/anonymise', [AnonymiseController, 'company'])
  .as('api.accounts.anonymise')
router
  .post('/api/accounts/:accountId/resources/:id/anonymise', [AnonymiseController, 'resource'])
  .as('api.resources.anonymise')
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
router.get('/api/diagnostics', async (ctx) => {
  const { response, logger } = ctx
  // Release level and backup timing are administration facts: Owners and Admins only.
  const administers = await withTransaction(async (trx) => {
    const actor = await resolveCurrentActor(ctx, trx)
    const memberships = await trx
      .from('memberships')
      .where({ user_id: actor.userId, status: 'active' })
      .select('account_id')
    for (const membership of memberships) {
      const role = await activeCompanyRole(actor.userId, String(membership.account_id), trx)
      if (role === 'owner' || role === 'admin') return true
    }
    return false
  })
  if (!administers)
    return response.forbidden({ error: 'Diagnostics are limited to Owners and Admins.' })
  try {
    await checkDatabase()
    const lastMigration = await db
      .from('adonis_schema')
      .select('name')
      .orderBy('id', 'desc')
      .first()
    let newestSnapshotAt: string | null = null
    const backupDir = env.get('CAPACITYLENS_BACKUP_DIR')
    if (backupDir) {
      try {
        const connectionConfig = db.getRawConnection(db.primaryConnectionName)?.config
        const databasePath =
          connectionConfig?.client === 'better-sqlite3'
            ? (connectionConfig.connection.filename as string)
            : null
        let databaseIdentity: FileIdentity | null = null
        if (databasePath && databasePath !== ':memory:') {
          const file = statSync(databasePath, { bigint: true })
          databaseIdentity = { path: resolve(databasePath), device: file.dev, inode: file.ino }
        }
        const newestMtime = listSnapshots(backupDir, databaseIdentity)
          .map((file) => statSync(join(backupDir, file)).mtimeMs)
          .reduce<number | null>(
            (newest, mtime) => (newest === null ? mtime : Math.max(newest, mtime)),
            null
          )
        newestSnapshotAt = newestMtime === null ? null : new Date(newestMtime).toISOString()
      } catch {
        logger.warn('Diagnostics could not inspect completed snapshots')
      }
    }
    return {
      server: {
        connectivity: 'ok',
        database: { status: 'ok' },
        schema: { migration: lastMigration?.name ?? null },
        backup: { newestSnapshotAt },
      },
    }
  } catch {
    logger.warn('Diagnostics could not read database state')
    return response.serviceUnavailable({
      server: {
        connectivity: 'ok',
        database: { status: 'unavailable' },
        schema: { migration: null },
        backup: { newestSnapshotAt: null },
      },
    })
  }
})
router.get('/api/accounts', [CompaniesController, 'index']).as('api.accounts.index')
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
      ('seed' in body && body.seed !== true && body.seed !== false && body.seed !== 'single'))
  )
    return response.badRequest({ error: 'Invalid reset request.' })
  const requestedSeed =
    body !== undefined && typeof body === 'object' && 'seed' in body
      ? (body.seed as boolean | 'single')
      : false
  await resetState(requestedSeed)
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
