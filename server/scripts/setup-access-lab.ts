import { authFromEnv, runAuthMigrations } from '../src/auth'
import { existsSync } from 'node:fs'
import { upsertMember } from '../src/controlTables'
import { insertAll, openDb } from '../src/db'
import {
  ACCESS_LAB_ACCOUNT_ID,
  ACCESS_LAB_PASSWORD,
  ACCESS_LAB_PERSONAS,
  buildAccessLabData,
  resolveAccessLabDbPath,
} from '../src/accessLab'

process.umask(0o077)

const dbPath = resolveAccessLabDbPath(process.env.CAPACITYLENS_DB)
if ([dbPath, `${dbPath}-wal`, `${dbPath}-shm`].some((path) => existsSync(path))) {
  throw new Error('Access-lab setup requires the launcher to remove the fixed fixture first.')
}

const db = openDb(dbPath)
try {
  const existingAccounts = (db.prepare('SELECT COUNT(*) AS count FROM accounts').get() as { count: number }).count
  if (existingAccounts !== 0) throw new Error('Access-lab database is not empty; the launcher must reset it first.')

  const { mode, auth } = authFromEnv(db, process.env, {
    trustedOrigins: ['http://localhost:5473', 'http://127.0.0.1:5473'],
  })
  if (mode !== 'password' || !auth) throw new Error('Access lab requires password authentication.')
  await runAuthMigrations(auth)
  insertAll(db, buildAccessLabData())

  const createdAt = new Date().toISOString()
  for (const persona of ACCESS_LAB_PERSONAS) {
    const user = await auth.createCredentialUser(
      persona.email,
      persona.name,
      ACCESS_LAB_PASSWORD,
      true,
    )
    upsertMember(db, {
      accountId: ACCESS_LAB_ACCOUNT_ID,
      userId: user.id,
      role: persona.role,
      status: 'active',
      createdAt,
    })
  }
} finally {
  db.close()
}

console.log('Access lab ready: Studio North with Owner, Admin, Editor, and Viewer personas.')
