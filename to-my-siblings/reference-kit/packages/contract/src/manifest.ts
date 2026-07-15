export const SMALLSASS_FAMILY = 'SmallSass' as const
export const SMALLSASS_CONTRACT_VERSION = '1.0.0' as const
export const SMALLSASS_KIT_VERSION = '0.1.0' as const

export type PersistenceKind = 'sqlite'
export type AuthenticationKind = 'better-auth'
export type OfflineWritePolicy = 'forbidden'

/**
 * The machine-readable compatibility claim stored as `smallsass.family.json` in every sibling.
 * JSON Schema performs boundary validation; this type gives product code and tooling one vocabulary.
 */
export interface SmallSassManifest {
  $schema: string
  family: typeof SMALLSASS_FAMILY
  contractVersion: typeof SMALLSASS_CONTRACT_VERSION
  kitVersion: string
  product: {
    name: string
    slug: string
    envPrefix: string
    storagePrefix: string
  }
  architecture: {
    tenantKey: 'accountId'
    persistence: PersistenceKind
    authentication: AuthenticationKind
    offlineWrites: OfflineWritePolicy
  }
  modes: {
    hosted: boolean
    selfHosted: boolean
    demo: 'memory-only' | 'unavailable'
  }
  packages: {
    contract: string
    tokens: string
    config: string
  }
  commands: {
    gate: string
    serverGate: string
    e2e: string
  }
  documentation: {
    decisions: string
    development: string
    operators: string[]
    familyHandbook: string
  }
}
