import db from '@adonisjs/lucid/services/db'
import {
  FIXTURE_ACCOUNT,
  FIXTURE_ACTIVITY,
  FIXTURE_ACTIVITY_INTERNAL,
  FIXTURE_ACTIVITY_REPEATABLE,
  FIXTURE_ALLOCATION,
  FIXTURE_ALLOCATION_ATTRIBUTED,
  FIXTURE_CLIENT,
  FIXTURE_CLOSURE,
  FIXTURE_DISCIPLINE,
  FIXTURE_PHASE,
  FIXTURE_PROJECT,
  FIXTURE_RESOURCE,
  FIXTURE_RESOURCE_EXTERNAL,
  FIXTURE_RESOURCE_PERSON,
  FIXTURE_TIMEOFF,
} from '@capacitylens/shared/data/fixtures'

const accountIds = { dc: 'a-studio', marvel: 'a-loft' } as const
const stamp = '2026-10-12T00:00:00.000Z'

export const accountIndexes = [
  ['clients', 'account_id'],
  ['disciplines', 'account_id'],
  ['projects', 'account_id'],
  ['phases', 'account_id'],
  ['resources', 'account_id'],
  ['activities', 'account_id'],
  ['allocations', 'account_id'],
  ['time_off', 'account_id'],
  ['closures', 'account_id'],
] as const

export const foreignKeyIndexes = [
  ['projects', 'client_id'],
  ['phases', 'project_id'],
  ['resources', 'discipline_id'],
  ['resources', 'project_id'],
  ['activities', 'project_id'],
  ['activities', 'phase_id'],
  ['allocations', 'resource_id'],
  ['allocations', 'activity_id'],
  ['allocations', 'project_id'],
  ['time_off', 'resource_id'],
] as const

export const baselineTables = [
  'accounts',
  'clients',
  'disciplines',
  'projects',
  'phases',
  'resources',
  'activities',
  'allocations',
  'time_off',
  'closures',
  'users',
  'provider_identities',
  'email_proofs',
  'sessions',
  'user_session_index',
  'rate_limits',
  'audit_entries',
  'memberships',
  'account_member_resources',
  'invitations',
  'invitation_proposals',
  'ownership_transfers',
  'masquerades',
  'command_results',
  'company_settings',
] as const

export function expectedFixture(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(expectedFixture)
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, child]) => child !== undefined)
      .map(([key, child]) => [key, expectedFixture(child)])
  )
}

export function encodeFixture(value: object) {
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`),
      Array.isArray(child) ||
      typeof child === 'boolean' ||
      (child !== null && typeof child === 'object')
        ? JSON.stringify(child)
        : (child ?? null),
    ])
  )
}

export function stripLifecycle<T extends { archivedAt?: string | null; deletedAt?: string | null }>(
  value: T
): T {
  return { ...value, archivedAt: null, deletedAt: null }
}

export const fullFixtureRows = [
  ['accounts', [FIXTURE_ACCOUNT]],
  ['clients', [stripLifecycle(FIXTURE_CLIENT)]],
  ['disciplines', [FIXTURE_DISCIPLINE]],
  ['projects', [stripLifecycle(FIXTURE_PROJECT)]],
  ['phases', [FIXTURE_PHASE]],
  [
    'resources',
    [
      stripLifecycle(FIXTURE_RESOURCE),
      stripLifecycle(FIXTURE_RESOURCE_PERSON),
      FIXTURE_RESOURCE_EXTERNAL,
    ],
  ],
  ['activities', [FIXTURE_ACTIVITY, FIXTURE_ACTIVITY_INTERNAL, FIXTURE_ACTIVITY_REPEATABLE]],
  ['allocations', [FIXTURE_ALLOCATION, FIXTURE_ALLOCATION_ATTRIBUTED]],
  ['time_off', [FIXTURE_TIMEOFF]],
  ['closures', [FIXTURE_CLOSURE]],
] as const

export async function insertInvalidReference(table: string, column: string, targetId: string) {
  const common = {
    account_id: accountIds.dc,
    id: `invalid-${table}-${column}`,
    created_at: stamp,
    updated_at: stamp,
  }
  const rows: Record<string, Record<string, unknown>> = {
    projects: { ...common, client_id: targetId, name: 'Invalid', color: '#111111' },
    phases: { ...common, project_id: targetId, name: 'Invalid' },
    resources: {
      ...common,
      kind: 'person',
      role: 'Designer',
      employment_type: 'permanent',
      engagement: 'studio',
      working_hours_per_day: 8,
      working_days: '[1,2,3,4,5]',
      half_days: '[]',
      color: '#111111',
      [column]: targetId,
    },
    activities: { ...common, name: 'Invalid', kind: 'project', [column]: targetId },
    allocations: {
      ...common,
      resource_id: 'm1-dc-resource',
      activity_id: 'm1-dc-activity',
      start_date: '2026-10-12',
      end_date: '2026-10-13',
      hours_per_day: 4,
      status: 'confirmed',
      [column]: targetId,
    },
    time_off: {
      ...common,
      resource_id: targetId,
      start_date: '2026-10-12',
      end_date: '2026-10-13',
      type: 'holiday',
    },
  }
  await db.table(table).insert(rows[table]!)
}

export const crossAccountReferences = [
  ['projects.client_id', 'projects', 'client_id', 'm1-marvel-client'],
  ['phases.project_id', 'phases', 'project_id', 'm1-marvel-project'],
  ['resources.discipline_id', 'resources', 'discipline_id', 'm1-marvel-discipline'],
  ['resources.project_id', 'resources', 'project_id', 'm1-marvel-project'],
  ['activities.project_id', 'activities', 'project_id', 'm1-marvel-project'],
  ['activities.phase_id', 'activities', 'phase_id', 'm1-marvel-phase'],
  ['allocations.resource_id', 'allocations', 'resource_id', 'm1-marvel-resource'],
  ['allocations.activity_id', 'allocations', 'activity_id', 'm1-marvel-activity'],
  ['allocations.project_id', 'allocations', 'project_id', 'm1-marvel-project'],
  ['time_off.resource_id', 'time_off', 'resource_id', 'm1-marvel-resource'],
] as const
