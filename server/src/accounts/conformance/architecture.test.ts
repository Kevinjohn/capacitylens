import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'

const serverRoot = resolve(import.meta.dirname, '../..')
const sharedAccountRoot = resolve(serverRoot, '../../shared/src/account')
const browserRoot = resolve(serverRoot, '../../src')

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    const source = /\.(?:[cm]?[jt]sx?)$/.test(entry.name)
    const test = /\.(?:test|spec)\.(?:[cm]?[jt]sx?)$/.test(entry.name)
    return source && !test ? [path] : []
  })
}

function runtimeImports(file: string): string[] {
  const source = readFileSync(file, 'utf8')
  const imports = new Set([
    ...[...source.matchAll(/import\s+(?!type\b)[\s\S]*?\sfrom\s+['"]([^'"]+)['"]/g)]
      .map((match) => match[1]!),
    ...[...source.matchAll(/(?:import|export)\s*['"]([^'"]+)['"]/g)]
      .map((match) => match[1]!),
    ...[...source.matchAll(/import\s*\(\s*['"]([^'"]+)['"]\s*\)/g)]
      .map((match) => match[1]!),
    ...[...source.matchAll(/export\s+(?!type\b)[\s\S]*?\sfrom\s+['"]([^'"]+)['"]/g)]
      .map((match) => match[1]!),
  ].filter((specifier) => specifier.startsWith('.')))
  return [...imports].flatMap((specifier) => {
    const base = resolve(dirname(file), specifier)
    const candidates = [base, `${base}.ts`, `${base}.tsx`, resolve(base, 'index.ts')]
    const resolved = candidates.find((candidate) => existsSync(candidate))
    return resolved ? [resolved] : []
  })
}

function dependencyPath(start: string, forbidden: ReadonlySet<string>): string[] | null {
  const queue: string[][] = [[start]]
  const visited = new Set<string>()
  while (queue.length > 0) {
    const path = queue.shift()!
    const current = path.at(-1)!
    if (visited.has(current)) continue
    visited.add(current)
    if (current !== start && forbidden.has(current)) return path
    for (const dependency of runtimeImports(current)) queue.push([...path, dependency])
  }
  return null
}

function displayPath(path: readonly string[]): string {
  return path.map((file) => relative(serverRoot, file)).join(' -> ')
}

describe('account-boundary architecture', () => {
  it('keeps the shared contract free of UI, transport, persistence, and auth-vendor imports', () => {
    for (const file of sourceFiles(sharedAccountRoot)) {
      const source = readFileSync(file, 'utf8')
      expect(source, file).not.toMatch(/from ['"](?:react|fastify|better-auth|node:sqlite|sqlite3|@fastify\/)['"]/)
      expect(source, file).not.toContain('/server/')
      expect(source, file).not.toContain('scheduler')
      expect(source, file).not.toContain('timeOff')
    }
  })

  it('keeps the coordinator orchestration-only', () => {
    const coordinator = resolve(serverRoot, 'accounts/localAccountFlows.ts')
    const source = readFileSync(coordinator, 'utf8')
    expect(source).not.toMatch(/\.prepare\s*\(|\b(?:SELECT|INSERT|UPDATE|DELETE)\b/)
    expect(source).not.toMatch(/from ['"].*(?:controlTables|better-auth)/)
    expect(source).not.toMatch(/ROLE_RANK|MIN_(?:ADMIN_)?TIER/)
    expect(source).not.toMatch(/(?:===|!==)\s*['"](?:owner|admin|editor|viewer)['"]/)

    const forbidden = new Set([
      resolve(serverRoot, 'auth.ts'),
      resolve(serverRoot, 'controlTables.ts'),
      resolve(serverRoot, 'erasure.ts'),
      resolve(serverRoot, 'accounts/betterAuthIdentityPort.ts'),
      resolve(serverRoot, 'accounts/sqliteAccountAdminPort.ts'),
    ])
    const path = dependencyPath(coordinator, forbidden)
    expect(path ? displayPath(path) : null).toBeNull()
  })

  it('calibrates the transitive dependency scanner against a known adapter edge', () => {
    const adapter = resolve(serverRoot, 'accounts/sqliteAccountAdminPort.ts')
    const controlTables = resolve(serverRoot, 'controlTables.ts')
    const path = dependencyPath(adapter, new Set([controlTables]))
    expect(path?.map((file) => relative(serverRoot, file))).toEqual([
      'accounts/sqliteAccountAdminPort.ts',
      'controlTables.ts',
    ])
  })

  it('single-sources account-administration thresholds behind the account policy seam', () => {
    const productPolicy = readFileSync(resolve(serverRoot, '../../shared/src/domain/access.ts'), 'utf8')
    const accountPolicy = readFileSync(resolve(sharedAccountRoot, 'policy.ts'), 'utf8')
    const productThresholds = productPolicy.match(/const MIN_TIER = \{[\s\S]*?\n\}/)?.[0] ?? ''
    expect(productThresholds).not.toMatch(/manageMembers|manageInvites|deleteAccount|transferOwnership/)
    expect(productPolicy).toContain('canAdministerAccount(role, accountAction)')
    expect(accountPolicy).toMatch(/'manage-members':\s*'admin'/)
    expect(accountPolicy).toMatch(/'manage-invitations':\s*'admin'/)
    expect(accountPolicy).toMatch(/'transfer-ownership':\s*'owner'/)
    expect(accountPolicy).toMatch(/'erase-workspace':\s*'owner'/)
  })

  it('makes account and identity storage ownership deny-by-default across production source', () => {
    const production = sourceFiles(serverRoot)
    const identitySqlOwners = new Set([
      resolve(serverRoot, 'auth.ts'),
      resolve(serverRoot, 'accounts/betterAuthIdentityPort.ts'),
    ])
    const accountSqlOwners = new Set([
      resolve(serverRoot, 'controlTables.ts'),
      resolve(serverRoot, 'db.ts'),
      resolve(serverRoot, 'accounts/sqliteAccountAdminPort.ts'),
    ])
    const controlTableImporters = new Set([
      resolve(serverRoot, 'db.ts'),
      resolve(serverRoot, 'accounts/sqliteAccountAdminPort.ts'),
    ])
    // `account` is Better Auth's singular provider-link table; CapacityLens product workspaces use
    // the plural `accounts`, so it can be enforced here without confusing the two ownership zones.
    const sqlTableOperation = String.raw`\b(?:FROM|JOIN|INTO|UPDATE|DELETE\s+FROM|(?:CREATE\s+)?TABLE(?:\s+IF\s+NOT\s+EXISTS)?|ALTER\s+TABLE|DROP\s+TABLE)\s+(?:["'\x60]|\[)?(?:\w+\.)?(?:["'\x60]|\[)?`
    const identitySql = new RegExp(
      `${sqlTableOperation}(?:user|session|account|verification|twoFactor)\\b`,
      'i',
    )
    const accountSql = new RegExp(`${sqlTableOperation}(?:account_members|invites)\\b`, 'i')

    for (const file of production) {
      const source = readFileSync(file, 'utf8')
      if (!identitySqlOwners.has(file)) expect(source, relative(serverRoot, file)).not.toMatch(identitySql)
      if (!accountSqlOwners.has(file)) expect(source, relative(serverRoot, file)).not.toMatch(accountSql)
      if (!controlTableImporters.has(file)) {
        expect(source, relative(serverRoot, file)).not.toMatch(/from ['"].*controlTables['"]/)
      }
      if (![resolve(serverRoot, 'auth.ts'), resolve(serverRoot, 'strictOidc.ts')].includes(file)) {
        expect(source, relative(serverRoot, file)).not.toMatch(/from ['"]better-auth(?:\/[^'"]*)?['"]/)
      }
    }
  })

  it('prevents product routes from reaching identity or membership storage directly', () => {
    const source = readFileSync(resolve(serverRoot, 'app.ts'), 'utf8')
    expect(source).not.toMatch(/from ['"].*controlTables/)
    expect(source).not.toMatch(/\b(?:user|session|account_members|invites)\b[^\n]*\.prepare\s*\(/)
    expect(source).not.toContain('better-auth')
  })

  it('keeps invitation and member administration in the account HTTP adapter', () => {
    const productRoutes = readFileSync(resolve(serverRoot, 'app.ts'), 'utf8')
    const accountRoutes = readFileSync(resolve(serverRoot, 'accounts/accountRoutes.ts'), 'utf8')
    const extractedPaths = [
      '/api/invites',
      '/api/invites/:token/preview',
      '/api/invites/:token/accept',
      '/api/invites/:token/signup',
      '/api/accounts/:accountId/members',
      '/api/accounts/:accountId/members/:userId',
      '/api/accounts/:accountId/transfer-ownership',
      '/api/accounts/:accountId/members/:userId/reset-password',
      '/api/accounts/:accountId/members/:userId/revoke-sessions',
      '/api/accounts/:accountId/invites',
      '/api/accounts/:accountId/invites/:id',
    ]
    for (const path of extractedPaths) {
      expect(accountRoutes, path).toContain(`'${path}'`)
      expect(productRoutes, path).not.toContain(`'${path}'`)
    }
    expect(accountRoutes).not.toMatch(/from ['"].*(?:betterAuthIdentityPort|better-auth|controlTables)/)
    expect(accountRoutes).not.toMatch(/\.prepare\s*\(|\b(?:SELECT|INSERT|UPDATE|DELETE FROM)\b/)
  })

  it('keeps invitation SQL out of the auth-vendor adapter', () => {
    const source = readFileSync(resolve(serverRoot, 'auth.ts'), 'utf8')
    expect(source).not.toMatch(/\b(?:FROM|INTO|UPDATE|DELETE FROM)\s+invites\b/i)
    expect(source).not.toMatch(/from ['"].*controlTables/)
  })

  it('centralizes executable browser account URLs in the account client', () => {
    const accountClient = resolve(browserRoot, 'account/accountClient.ts')
    for (const file of sourceFiles(browserRoot)) {
      if (file === accountClient) continue
      const source = readFileSync(file, 'utf8')
      expect(source, file).not.toMatch(/fetch\s*\([^\n]*(?:\/api\/(?:auth\/me|accounts|invites|orgs))/)
      expect(source, file).not.toMatch(/apiFetch(?:Reauth)?\s*\([^\n]*(?:\/api\/(?:accounts|invites|orgs))/)
    }
  })
})
