import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

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
    const source = readFileSync(resolve(serverRoot, 'accounts/localAccountFlows.ts'), 'utf8')
    expect(source).not.toMatch(/\.prepare\s*\(|\b(?:SELECT|INSERT|UPDATE|DELETE)\b/)
    expect(source).not.toMatch(/from ['"].*(?:controlTables|better-auth)/)
    expect(source).not.toMatch(/ROLE_RANK|MIN_(?:ADMIN_)?TIER/)
    expect(source).not.toMatch(/(?:===|!==)\s*['"](?:owner|admin|editor|viewer)['"]/)
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
