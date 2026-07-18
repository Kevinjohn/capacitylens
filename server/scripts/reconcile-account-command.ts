import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { openDbConnection, planDatabaseMigrations } from '../src/db'
import {
  assertAccountBoundaryStateCurrent,
  closeAccountCommandReconciliation,
  getAccountCommandByIdForReconciliation,
} from '../src/accounts/state'

const [databasePath, applicationId, commandId, operatorReference] = process.argv.slice(2)
if (!databasePath || !applicationId || !commandId || !operatorReference) {
  console.error(
    'Usage: tsx scripts/reconcile-account-command.ts <database> <application-id> <command-id> <operator-reference>',
  )
  process.exitCode = 2
} else {
  if (databasePath === ':memory:' || !existsSync(databasePath)) {
    throw new Error('The reconciliation database must be an existing on-disk CapacityLens database.')
  }
  // This is a narrowly scoped repair tool, not an alternate application startup path. Opening a
  // stale database through openDb() would silently run migrations without the production rollback
  // snapshot ceremony, so require the daemon to have completed migrations first.
  const db = openDbConnection(databasePath)
  try {
    const migrationPlan = planDatabaseMigrations(db)
    if (migrationPlan.migrations.length > 0) {
      throw new Error(
        `Database schema v${migrationPlan.fromVersion} is not current (expected v${migrationPlan.toVersion}); ` +
        'start this release normally to complete its backed-up migration before reconciliation.',
      )
    }
    assertAccountBoundaryStateCurrent(db)
    const record = getAccountCommandByIdForReconciliation(db, applicationId, commandId)
    if (!record) throw new Error('No matching account command exists.')
    if (record.status !== 'reconciliation_required') {
      throw new Error(`Command is ${record.status}; only reconciliation_required commands can be closed.`)
    }
    const referenceHash = createHash('sha256').update(operatorReference).digest('hex')
    if (!closeAccountCommandReconciliation(db, applicationId, commandId, referenceHash)) {
      throw new Error('The command changed while reconciliation was being closed; inspect it again.')
    }
    console.log(JSON.stringify({ commandId, status: 'compensated', referenceHash }))
  } finally {
    db.close()
  }
}
