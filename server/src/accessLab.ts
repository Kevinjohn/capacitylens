import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Role } from '@capacitylens/shared/domain/access'
import { seed } from '@capacitylens/shared/data/seed'
import type { AppData } from '@capacitylens/shared/types/entities'

export const ACCESS_LAB_ACCOUNT_ID = 'a-studio'
export const ACCESS_LAB_PASSWORD = 'access-lab-password-2026'
export const ACCESS_LAB_DB_PATH = fileURLToPath(new URL('../.access-lab.db', import.meta.url))

/** Resolve and verify the one database the destructive lab setup may initialise. */
export function resolveAccessLabDbPath(configuredPath: string | undefined): string {
  const resolved = resolve(configuredPath ?? '')
  if (resolved !== ACCESS_LAB_DB_PATH) {
    throw new Error(`Access-lab setup refuses every database except ${ACCESS_LAB_DB_PATH}.`)
  }
  return resolved
}

export const ACCESS_LAB_PERSONAS: ReadonlyArray<{
  name: string
  email: string
  role: Role
}> = [
  { name: 'Olivia Owner', email: 'owner@capacitylens.dev', role: 'owner' },
  { name: 'Alex Admin', email: 'alex.admin@capacitylens.dev', role: 'admin' },
  { name: 'Erin Editor', email: 'erin.editor@capacitylens.dev', role: 'editor' },
  { name: 'Vic Viewer', email: 'vic.viewer@capacitylens.dev', role: 'viewer' },
]

/** The normal Studio North demo slice, narrowed to one company and made access-control-visible. */
export function buildAccessLabData(): AppData {
  const source = seed()
  return {
    accounts: source.accounts.filter((row) => row.id === ACCESS_LAB_ACCOUNT_ID),
    disciplines: source.disciplines.filter((row) => row.accountId === ACCESS_LAB_ACCOUNT_ID),
    resources: source.resources.filter((row) => row.accountId === ACCESS_LAB_ACCOUNT_ID),
    clients: source.clients
      .filter((row) => row.accountId === ACCESS_LAB_ACCOUNT_ID)
      .map((row) => row.id === 'c-acme'
        ? { ...row, isPrivate: true, codeName: 'Northstar' }
        : row),
    projects: source.projects
      .filter((row) => row.accountId === ACCESS_LAB_ACCOUNT_ID)
      .map((row) => row.id === 'p-acme'
        ? { ...row, isPrivate: true, codeName: 'Aurora' }
        : row),
    phases: source.phases.filter((row) => row.accountId === ACCESS_LAB_ACCOUNT_ID),
    activities: source.activities.filter((row) => row.accountId === ACCESS_LAB_ACCOUNT_ID),
    allocations: source.allocations.filter((row) => row.accountId === ACCESS_LAB_ACCOUNT_ID),
    timeOff: source.timeOff.filter((row) => row.accountId === ACCESS_LAB_ACCOUNT_ID),
  }
}
