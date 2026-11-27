import { randomUUID } from 'node:crypto'
import type { ApiClient, ApiRequest, ApiResponse } from '@japa/api-client'
import db from '@adonisjs/lucid/services/db'
import { seed } from '@capacitylens/shared/data/seed'
import { companyId, session } from '#tests/helpers/planning/functional_helpers'
import { readPlanningRevision } from '#tests/helpers/data/planning_revision'

// Every named route is classified by whether its reply can carry a restricted value. Routes that can
// are called for every test user, and the raw reply must not contain a value that user's
// effective role may not see. A new route fails the classification test until it is reviewed in `replies`.

const MARKER_CLIENT = 'MARKER_CLIENT_KANE'
const MARKER_ARCHIVED_CLIENT = 'MARKER_ARCHIVED_FALCONE'
const MARKER_PROJECT = 'MARKER_PROJECT_MONARCH'
const MARKER_NOTE = 'MARKER_NOTE_ARKHAM'
/** The code name each private name marker carries; a reader who may not see the name gets it quoted. */
export const codeNamesByMarker: Record<string, string> = {
  [MARKER_CLIENT]: 'Nightwing',
  [MARKER_ARCHIVED_CLIENT]: 'Oracle',
  [MARKER_PROJECT]: 'Aurora',
}

type Role = 'owner' | 'admin' | 'editor' | 'viewer'

interface TestUser {
  label: string
  effective: Role
  masquerade: boolean
  /** The signed-in role behind a view-as test user; Owner when absent. */
  actor?: Role
  /** A view-as target the server must refuse; the test user then reads as itself. */
  refusedTarget?: Role
}

export interface Fixture {
  client: ApiClient
  ownerCookie: string
  cookie: string
  clientId: string
  projectId: string
  timeOffId: string
  resourceId: string
}

export const testUsers: TestUser[] = [
  { label: 'Owner', effective: 'owner', masquerade: false },
  { label: 'Admin', effective: 'admin', masquerade: false },
  { label: 'Editor', effective: 'editor', masquerade: false },
  { label: 'Viewer', effective: 'viewer', masquerade: false },
  { label: 'Owner viewing as Admin', effective: 'admin', masquerade: true },
  { label: 'Owner viewing as Editor', effective: 'editor', masquerade: true },
  { label: 'Owner viewing as Viewer', effective: 'viewer', masquerade: true },
  { label: 'Admin viewing as Admin', effective: 'admin', masquerade: true, actor: 'admin' },
  { label: 'Admin viewing as Editor', effective: 'editor', masquerade: true, actor: 'admin' },
  { label: 'Admin viewing as Viewer', effective: 'viewer', masquerade: true, actor: 'admin' },
  {
    label: 'Admin refused a view as Owner',
    effective: 'admin',
    masquerade: false,
    refusedTarget: 'owner',
  },
]

/** Names are visible to an effective Owner only; the time-off note to an effective Owner or Admin. */
export function listHiddenMarkers(role: Role) {
  const hidden: string[] = []
  if (role !== 'owner') hidden.push(MARKER_CLIENT, MARKER_ARCHIVED_CLIENT, MARKER_PROJECT)
  if (role !== 'owner' && role !== 'admin') hidden.push(MARKER_NOTE)
  return hidden
}

/** Only an effective Owner or Admin gets archived rows from the state and export routes. */
function canReadInactive(role: Role) {
  return role === 'owner' || role === 'admin'
}

const IDENTITY = 'identity or account reply with no client, project or time-off rows'
const COUNTS = 'counts, ids or no body'
const PREVIEW =
  "Owner only, refused while viewing as: the caller document's name and counts, the revision and a changed flag"

async function send<T extends ApiRequest>(request: T, cookie: string, intent: object) {
  return session(request, cookie)
    .json({ mutationId: randomUUID(), baseRevision: await readPlanningRevision(companyId), intent })
    .send()
}

/** A preset colour used by a seeded client that differs from the row's own, so the update is a real
 * change. */
async function pickOtherColor(table: 'clients' | 'projects', id: string) {
  // Both tables store `color` as a non-null preset string.
  const own = (await db.from(table).where('id', id).first()) as { color: string }
  const presets = (await db
    .from('clients')
    .where('company_id', companyId)
    .select('color')) as Array<{ color: string }>
  const other = presets.find((row) => row.color !== own.color)
  if (!other) throw new Error('The seed needs two client colours')
  return other.color
}

async function archiveAsOwner(fixture: Fixture, intent: object) {
  const archived = await send(
    fixture.client.visit('api.planning_mutations.store', { companyId }),
    fixture.ownerCookie,
    intent
  )
  archived.assertStatus(200)
}

/** Recolours the marked client under a history, a change every writer may make and undo. */
async function recolourClient(fixture: Fixture, historyId: string) {
  return session(
    fixture.client.visit('api.planning_mutations.store', { companyId }),
    fixture.cookie
  )
    .json({
      mutationId: randomUUID(),
      baseRevision: await readPlanningRevision(companyId),
      historyId,
      intent: {
        operation: 'catalogue.update',
        entity: {
          entity: 'clients',
          id: fixture.clientId,
          changes: { color: await pickOtherColor('clients', fixture.clientId) },
        },
      },
    })
    .send()
}

async function stepHistory(fixture: Fixture, step: 'undo' | 'redo', historyId: string) {
  return session(
    fixture.client.visit(step === 'undo' ? 'api.planning_undo.store' : 'api.planning_redo.store', {
      companyId,
    }),
    fixture.cookie
  )
    .json({
      mutationId: randomUUID(),
      baseRevision: await readPlanningRevision(companyId),
      historyId,
    })
    .send()
}

type Exposure =
  | {
      call: (fixture: Fixture, testUser: TestUser) => Promise<ApiResponse>
      write: boolean
      /** Markers the reply carries for a reader allowed to see them. */
      carries: string[] | ((testUser: TestUser) => string[])
    }
  | { none: string }

export const replies: Record<string, Exposure> = {
  'api.planning.show': {
    write: false,
    carries: [MARKER_CLIENT, MARKER_PROJECT, MARKER_NOTE],
    call: (fixture) =>
      session(fixture.client.visit('api.planning.show', { companyId }), fixture.cookie).send(),
  },
  'api.planning_archive.show': {
    write: false,
    carries: [MARKER_ARCHIVED_CLIENT],
    call: (fixture) =>
      session(
        fixture.client.visit('api.planning_archive.show', { companyId }),
        fixture.cookie
      ).send(),
  },
  'api.company_exports.show': {
    write: false,
    carries: (testUser) => [
      MARKER_CLIENT,
      MARKER_PROJECT,
      MARKER_NOTE,
      ...(canReadInactive(testUser.effective) ? [MARKER_ARCHIVED_CLIENT] : []),
    ],
    call: (fixture) =>
      session(
        fixture.client.visit('api.company_exports.show', { companyId }),
        fixture.cookie
      ).send(),
  },
  'api.company_state.show': {
    write: false,
    carries: (testUser) => [
      MARKER_CLIENT,
      MARKER_PROJECT,
      MARKER_NOTE,
      ...(canReadInactive(testUser.effective) ? [MARKER_ARCHIVED_CLIENT] : []),
    ],
    call: (fixture, testUser) => {
      const inactive = canReadInactive(testUser.effective)
      return session(
        fixture.client
          .visit('api.company_state.show')
          .qs({ companyId, ...(inactive ? { includeInactive: '1' as const } : {}) }),
        fixture.cookie
      ).send()
    },
  },
  'api.planning_mutations.store#catalogue.update clients': {
    write: true,
    carries: [MARKER_CLIENT],
    call: async (fixture) =>
      send(fixture.client.visit('api.planning_mutations.store', { companyId }), fixture.cookie, {
        operation: 'catalogue.update',
        entity: {
          entity: 'clients',
          id: fixture.clientId,
          changes: { color: await pickOtherColor('clients', fixture.clientId) },
        },
      }),
  },
  'api.planning_mutations.store#catalogue.restore clients': {
    write: true,
    carries: [MARKER_CLIENT],
    call: async (fixture) => {
      const entity = { entity: 'clients', id: fixture.clientId }
      await archiveAsOwner(fixture, {
        operation: 'catalogue.archive',
        entity,
      })
      return send(
        fixture.client.visit('api.planning_mutations.store', { companyId }),
        fixture.cookie,
        {
          operation: 'catalogue.restore',
          entity,
        }
      )
    },
  },
  'api.planning_mutations.store#catalogue.update projects': {
    write: true,
    carries: [MARKER_PROJECT],
    call: async (fixture) =>
      send(fixture.client.visit('api.planning_mutations.store', { companyId }), fixture.cookie, {
        operation: 'catalogue.update',
        entity: {
          entity: 'projects',
          id: fixture.projectId,
          changes: { color: await pickOtherColor('projects', fixture.projectId) },
        },
      }),
  },
  'api.planning_mutations.store#catalogue.restore projects': {
    write: true,
    carries: [MARKER_PROJECT],
    call: async (fixture) => {
      const entity = { entity: 'projects', id: fixture.projectId }
      await archiveAsOwner(fixture, {
        operation: 'catalogue.archive',
        entity,
      })
      return send(
        fixture.client.visit('api.planning_mutations.store', { companyId }),
        fixture.cookie,
        {
          operation: 'catalogue.restore',
          entity,
        }
      )
    },
  },
  'api.planning_mutations.store#timeOff.update': {
    write: true,
    carries: [MARKER_NOTE],
    call: async (fixture) => {
      const row = await db.from('time_off').where('id', fixture.timeOffId).first()
      const type = row?.type === 'holiday' ? 'sick' : 'holiday'
      return send(
        fixture.client.visit('api.planning_mutations.store', { companyId }),
        fixture.cookie,
        {
          operation: 'timeOff.update',
          id: fixture.timeOffId,
          changes: { type },
        }
      )
    },
  },
  'api.planning_mutations.store#resource.restore': {
    write: true,
    carries: [],
    call: async (fixture) => {
      await archiveAsOwner(fixture, {
        operation: 'resource.archive',
        id: fixture.resourceId,
      })
      return send(
        fixture.client.visit('api.planning_mutations.store', { companyId }),
        fixture.cookie,
        {
          operation: 'resource.restore',
          id: fixture.resourceId,
        }
      )
    },
  },
  'api.planning_mutations.store#planning.restoreGroup': {
    write: true,
    carries: [MARKER_NOTE],
    call: async (fixture) => {
      const deleted = await send(
        fixture.client.visit('api.planning_mutations.store', { companyId }),
        fixture.cookie,
        {
          operation: 'timeOff.delete',
          id: fixture.timeOffId,
        }
      )
      const groupId =
        deleted.status() === 200
          ? // A committed delete reply always carries its replacement restoration group.
            (deleted.body() as { data: { restoration: { replacementGroupId: string } } }).data
              .restoration.replacementGroupId
          : randomUUID()
      return send(
        fixture.client.visit('api.planning_mutations.store', { companyId }),
        fixture.cookie,
        {
          operation: 'planning.restoreGroup',
          restorationGroupId: groupId,
        }
      )
    },
  },
  'api.planning_undo.store': {
    write: true,
    carries: [MARKER_CLIENT],
    call: async (fixture) => {
      const historyId = randomUUID()
      await recolourClient(fixture, historyId)
      return stepHistory(fixture, 'undo', historyId)
    },
  },
  'api.planning_redo.store': {
    write: true,
    carries: [MARKER_CLIENT],
    call: async (fixture) => {
      const historyId = randomUUID()
      await recolourClient(fixture, historyId)
      await stepHistory(fixture, 'undo', historyId)
      return stepHistory(fixture, 'redo', historyId)
    },
  },
  'api.company_anonymisations.store': { none: COUNTS },
  'api.companies.index': { none: IDENTITY },
  'api.admission_approvals.store': { none: IDENTITY },
  'api.memberships.store': { none: IDENTITY },
  'api.admission_requests.index': { none: IDENTITY },
  'api.admission_rejections.store': { none: IDENTITY },
  'api.admission_requests.store': { none: IDENTITY },
  'api.admission_revocations.store': { none: IDENTITY },
  'api.admission.show': { none: IDENTITY },
  'api.password.update': { none: IDENTITY },
  'api.account.destroy': { none: IDENTITY },
  'api.password_resets.show': { none: IDENTITY },
  'api.session.show': { none: IDENTITY },
  'api.password_confirmations.store': { none: IDENTITY },
  'api.password_reset_requests.store': { none: IDENTITY },
  'api.password_resets.update': { none: IDENTITY },
  'api.session.store': { none: IDENTITY },
  'api.session.destroy': { none: IDENTITY },
  'api.new_account.store': { none: IDENTITY },
  'api.email_verifications.update': { none: IDENTITY },
  'api.email_verifications.show': { none: IDENTITY },
  'api.email_verification_requests.store': { none: IDENTITY },
  'api.diagnostics.show': { none: IDENTITY },
  'api.example_data.store': { none: COUNTS },
  'api.getting_started.show': { none: IDENTITY },
  'api.getting_started.update': { none: IDENTITY },
  'health_checks.live': { none: IDENTITY },
  'health_checks.ready': { none: IDENTITY },
  'spa_fallback': { none: IDENTITY },
  'api.first_company_setup.store': { none: IDENTITY },
  'api.invitations.store': { none: IDENTITY },
  'api.invitations.index': { none: IDENTITY },
  'api.invitation_links.show': { none: IDENTITY },
  'api.invitation_deliveries.store': { none: IDENTITY },
  'api.invitations.destroy': { none: IDENTITY },
  'api.invitation_acceptances.store': { none: IDENTITY },
  'api.masquerade.destroy': { none: IDENTITY },
  'api.masquerade.store': { none: IDENTITY },
  'api.masquerade.show': { none: IDENTITY },
  'api.member_resource_links.destroy': { none: IDENTITY },
  'api.member_resource_links.update': { none: IDENTITY },
  'api.members.index': { none: IDENTITY },
  'api.members.update': { none: IDENTITY },
  'api.member_status.update': { none: IDENTITY },
  'api.member_sign_in_tracking.update': { none: IDENTITY },
  'api.not_found': { none: IDENTITY },
  'api.ownership_transfers.store': { none: IDENTITY },
  'api.resource_anonymisations.store': { none: COUNTS },
  'api.imports.store': { none: COUNTS },
  'api.import_previews.store': { none: PREVIEW },
}

/** Marks one client, project and time-off note, and adds an archived private client. */
export async function prepareMarkers(client: ApiClient, ownerCookie: string) {
  const fixture = seed()
  const clientRow = fixture.clients.find((row) => row.companyId === companyId && !row.builtin)
  const projectRow = fixture.projects.find((row) => row.clientId === clientRow?.id)
  const timeOffRow = fixture.timeOff.find((row) => row.companyId === companyId)
  if (!clientRow || !projectRow || !timeOffRow) throw new Error('Seed data lacks the marker rows')
  await db.from('clients').where({ id: clientRow.id }).update({
    name: MARKER_CLIENT,
    is_private: true,
    code_name: codeNamesByMarker[MARKER_CLIENT],
  })
  await db.from('projects').where({ id: projectRow.id }).update({
    name: MARKER_PROJECT,
    is_private: true,
    code_name: codeNamesByMarker[MARKER_PROJECT],
  })
  await db.from('time_off').where({ id: timeOffRow.id }).update({ note: MARKER_NOTE })
  const archivedId = randomUUID()
  const created = await send(
    client.visit('api.planning_mutations.store', { companyId }),
    ownerCookie,
    {
      operation: 'catalogue.create',
      entity: {
        entity: 'clients',
        id: archivedId,
        fields: {
          name: MARKER_ARCHIVED_CLIENT,
          color: clientRow.color,
          isPrivate: true,
          codeName: codeNamesByMarker[MARKER_ARCHIVED_CLIENT],
        },
      },
    }
  )
  created.assertStatus(200)
  const archived = await send(
    client.visit('api.planning_mutations.store', { companyId }),
    ownerCookie,
    {
      operation: 'catalogue.archive',
      entity: { entity: 'clients', id: archivedId },
    }
  )
  archived.assertStatus(200)
  return {
    clientId: clientRow.id,
    projectId: projectRow.id,
    timeOffId: timeOffRow.id,
    resourceId: timeOffRow.resourceId,
  }
}

export async function readContextToken(client: ApiClient, cookie: string) {
  const status = await session(client.visit('api.masquerade.show'), cookie).send()
  status.assertStatus(200)
  // The status reply is checked by String(); a missing token fails the masquerade start.
  return String((status.body()!.data as { masqueradeToken: unknown }).masqueradeToken)
}

export async function startMasqueradeAs(
  client: ApiClient,
  viewerCookie: string,
  targetUserId: string
) {
  return session(
    client
      .visit('api.masquerade.store', { companyId })
      .header('X-Masquerade-Context', await readContextToken(client, viewerCookie)),
    viewerCookie
  )
    .json({ targetUserId })
    .send()
}
