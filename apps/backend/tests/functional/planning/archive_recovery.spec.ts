import { randomUUID } from 'node:crypto'
import { test } from '@japa/runner'
import type { ApiClient, ApiRequest } from '@japa/api-client'
import type { AppData } from '@capacitylens/shared/types/entities'
import type { ArchiveRecovery, ArchiveRecoveryRow } from '@capacitylens/shared/domain/lifecycle'
import db from '@adonisjs/lucid/services/db'
import { freshDatabase } from '../../helpers/fresh_database.js'
import { encodeRow, readState } from '#services/state_repository'
import {
  accountId,
  configureAuth,
  resetPlanningFixture,
  session,
  signIn,
  trusted,
} from './helpers.js'

const route = (path: string, companyId = accountId) => `/api/accounts/${companyId}/${path}`
const archiveUrl = route('planning/archive')
const stamp = '2026-10-01T00:00:00.000Z'
const privateClientName = 'Wayne Archive Client'
const privateClientCode = 'Project Nightwing'
const privateProjectName = 'Wayne Archive Project'
const privateProjectCode = 'Project Bat Project'

type PlanningBody = {
  revision: number
  data: AppData
}

type MutationBody = {
  revision: number
  projection: {
    mode: string
    changed: {
      upserts: Array<{ entity: string; row: { id: string } }>
      removed: Array<{ entity: string; id: string }>
    }
  }
}

function recovery(response: { body(): unknown }) {
  return response.body() as ArchiveRecovery
}

function planning(response: { body(): unknown }) {
  return response.body() as PlanningBody
}

function mutation(response: { body(): unknown }) {
  return response.body() as MutationBody
}

function requestWithContext<T extends ApiRequest>(request: T, cookie: string, context?: string) {
  const authenticated = session(request, cookie)
  return context ? authenticated.header('X-Masquerade-Context', context) : authenticated
}

function mutationInput(baseRevision: number, intent: Record<string, unknown>) {
  return { mutationId: randomUUID(), baseRevision, intent }
}

function unarchiveOperation(entity: ArchiveRecoveryRow['entity'], id: string) {
  if (entity === 'resources')
    return {
      path: `resources/${id}/unarchive`,
      intent: { operation: 'resource.unarchive', id },
    }
  return {
    path: `${entity}/${id}/unarchive`,
    intent: { operation: 'catalogue.unarchive', entity: { entity, id } },
  }
}

async function unarchive(
  client: ApiClient,
  cookie: string,
  entity: ArchiveRecoveryRow['entity'],
  id: string,
  baseRevision: number
) {
  const operation = unarchiveOperation(entity, id)
  return session(client.post(route(operation.path)), cookie)
    .json(mutationInput(baseRevision, operation.intent))
    .send()
}

function requireRow<T>(row: T | undefined, label: string): T {
  if (!row) throw new Error(`Missing archive-recovery fixture row: ${label}`)
  return row
}

/** Add private, archived and inherited-hidden rows with data that must not leave the server. */
async function prepareArchiveFixture(archiveProject = false) {
  const data = await readState(accountId, true)
  const client = requireRow(
    data.clients.find((row) => row.id === 'c-acme'),
    'c-acme'
  )
  const project = requireRow(
    data.projects.find((row) => row.id === 'p-brand'),
    'p-brand'
  )

  await db.from('clients').where({ id: client.id, account_id: accountId }).update({
    name: privateClientName,
    is_private: 'true',
    code_name: privateClientCode,
    archived_at: stamp,
  })
  await db.from('projects').where({ id: 'p-acme', account_id: accountId }).update({
    name: privateProjectName,
    is_private: 'true',
    code_name: privateProjectCode,
  })
  await db
    .from('projects')
    .where({ id: project.id, account_id: accountId })
    .update({
      is_private: 'true',
      code_name: null,
      ...(archiveProject ? { archived_at: stamp } : {}),
    })
  await db.from('resources').where({ id: 'r-tyler', account_id: accountId }).update({
    archived_at: stamp,
    role: 'Secret Designer Role',
    avatar_url: 'private-avatar-sentinel',
  })
  await db.from('resources').where({ id: 'r-alex', account_id: accountId }).update({
    archived_at: stamp,
    engagement: 'supplementary',
  })
  await db.from('resources').where({ id: 'r-ext-northstar', account_id: accountId }).update({
    archived_at: stamp,
  })
  await db.from('resources').where({ id: 'r-ph-designer', account_id: accountId }).update({
    project_id: project.id,
  })
  await db.from('activities').where({ id: 't-admin', account_id: accountId }).update({
    archived_at: stamp,
  })
  await db.from('clients').where({ id: 'c-internal-studio', account_id: accountId }).update({
    archived_at: stamp,
  })

  const deletedClient = {
    ...client,
    id: 'c-deleted-parent',
    name: 'Deleted Wayne Client',
    isPrivate: false,
    codeName: null,
    archivedAt: null,
    deletedAt: stamp,
  }
  const deletedProject = {
    ...project,
    id: 'p-deleted-child',
    name: 'Archived LexCorp Project',
    clientId: deletedClient.id,
    isPrivate: false,
    codeName: null,
    archivedAt: stamp,
    deletedAt: null,
  }
  await db.table('clients').insert(encodeRow('clients', deletedClient))
  await db.table('projects').insert(encodeRow('projects', deletedProject))
  await db.from('resources').where({ id: 'r-nike', account_id: accountId }).update({
    project_id: deletedProject.id,
  })

  const verified = await readState(accountId, true)
  if (
    verified.clients.find((row) => row.id === client.id)?.isPrivate !== true ||
    verified.projects.find((row) => row.id === project.id)?.isPrivate !== true ||
    verified.projects.find((row) => row.id === project.id)?.codeName !== null
  )
    throw new Error('Private archive fixtures did not round-trip through the SQLite JSON columns.')

  return { data, clientId: client.id, projectId: project.id }
}

test.group('identity-only archive recovery', (suite) => {
  suite.setup(() => freshDatabase())
  suite.each.setup(async () => {
    await resetPlanningFixture()
  })

  test('returns stable identity-only rows for Editor, Admin and Owner with role-correct labels', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup)
    const { clientId, projectId } = await prepareArchiveFixture(true)
    const actor = await signIn(client, 'editor')

    for (const role of ['editor', 'admin', 'owner'] as const) {
      await db
        .from('memberships')
        .where({ user_id: actor.userId, account_id: accountId })
        .update({ role })
      const response = await session(client.get(archiveUrl), actor.cookie).send()
      assert.equal(response.status(), 200, response.text())
      const body = recovery(response)
      assert.equal(body.accountId, accountId)
      assert.deepEqual(Object.keys(response.body() as object).sort(), ['accountId', 'rows'])

      const expectedKeys = ['archived', 'entity', 'id', 'label', 'parent']
      for (const row of body.rows) {
        assert.deepEqual(
          Object.keys(row).sort(),
          row.entity === 'resources' ? [...expectedKeys, 'group'].sort() : expectedKeys
        )
        if (row.parent) assert.deepEqual(Object.keys(row.parent).sort(), ['entity', 'id', 'label'])
      }

      const byId = new Map(body.rows.map((row) => [row.id, row]))
      const privateClient = requireRow(byId.get(clientId), 'private archived client')
      const hiddenProject = requireRow(byId.get('p-acme'), 'project hidden by archived client')
      const archivedProject = requireRow(byId.get(projectId), 'archived private project')
      const hiddenPlaceholder = requireRow(byId.get('r-ph-designer'), 'project-bound placeholder')
      const privateActivity = requireRow(byId.get('t-brand'), 'activity hidden by archived project')

      assert.equal(privateClient.entity, 'clients')
      assert.equal(privateClient.archived, true)
      assert.equal(
        privateClient.label,
        role === 'owner' ? privateClientName : '"Project Nightwing"'
      )
      assert.equal(hiddenProject.entity, 'projects')
      assert.equal(hiddenProject.archived, false)
      assert.equal(
        hiddenProject.label,
        role === 'owner' ? privateProjectName : '"Project Bat Project"'
      )
      assert.deepEqual(hiddenProject.parent, {
        entity: 'clients',
        id: clientId,
        label: role === 'owner' ? privateClientName : '"Project Nightwing"',
      })
      assert.equal(
        archivedProject.label,
        role === 'owner' ? 'Metropolis Rebrand' : '"Confidential #pbrand"'
      )
      assert.equal(archivedProject.archived, true)
      assert.isNull(archivedProject.parent)
      assert.deepEqual(hiddenPlaceholder, {
        id: 'r-ph-designer',
        entity: 'resources',
        group: 'placeholders',
        label: 'Senior Designer',
        archived: false,
        parent: {
          entity: 'projects',
          id: projectId,
          label: role === 'owner' ? 'Metropolis Rebrand' : '"Confidential #pbrand"',
        },
      })
      assert.deepEqual(privateActivity.parent, {
        entity: 'projects',
        id: projectId,
        label: role === 'owner' ? 'Metropolis Rebrand' : '"Confidential #pbrand"',
      })

      const resourceGroups = new Set(
        body.rows
          .filter((row) => row.entity === 'resources')
          .map((row) => (row.entity === 'resources' ? row.group : ''))
      )
      assert.deepEqual([...resourceGroups].sort(), [
        'external',
        'placeholders',
        'studio',
        'supplementary',
      ])
      assert.equal(byId.has('c-internal-studio'), false)
      assert.equal(byId.has('p-deleted-child'), false)
      assert.equal(byId.has('r-nike'), false)
      assert.equal(byId.has('p-loft-app'), false)
      assert.equal(byId.has('t-design'), false)
      assert.equal(byId.has('r-pam'), false)

      const sorted = [...body.rows].sort(
        (left, right) =>
          left.label.localeCompare(right.label, undefined, { sensitivity: 'base' }) ||
          left.id.localeCompare(right.id)
      )
      assert.deepEqual(body.rows, sorted)

      const serialized = response.text()
      assert.notInclude(serialized, 'Secret Designer Role')
      assert.notInclude(serialized, 'private-avatar-sentinel')
      assert.notInclude(serialized, 'archivedAt')
      assert.notInclude(serialized, 'deletedAt')
      assert.notInclude(serialized, 'codeName')
      assert.notInclude(serialized, 'employmentType')
      assert.notInclude(serialized, 'note')
      assert.notInclude(serialized, 'Deleted Wayne Client')
      assert.notInclude(serialized, 'Archived LexCorp Project')
      if (role !== 'owner') {
        assert.notInclude(serialized, privateClientName)
        assert.notInclude(serialized, privateProjectName)
      }
    }
  })

  test('refuses Viewer, inactive membership, foreign company, invalid session and masquerade', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup)
    const viewer = await signIn(client, 'viewer')
    const viewerRead = await session(client.get(archiveUrl), viewer.cookie).send()
    viewerRead.assertStatus(403)

    const editor = await signIn(client, 'editor')
    const foreignRead = await session(
      client.get(route('planning/archive', 'a-loft')),
      editor.cookie
    ).send()
    foreignRead.assertStatus(403)
    const inactiveRead = await session(client.get(archiveUrl), editor.cookie).send()
    inactiveRead.assertStatus(200)
    await db.from('memberships').where({ user_id: editor.userId, account_id: accountId }).update({
      status: 'archived',
    })
    const removedRead = await session(client.get(archiveUrl), editor.cookie).send()
    removedRead.assertStatus(403)

    const invalidSessionActor = await signIn(client, 'editor')
    await db.from('account_sessions').where({ user_id: invalidSessionActor.userId }).delete()
    const invalidSession = await session(client.get(archiveUrl), invalidSessionActor.cookie).send()
    invalidSession.assertStatus(401)

    const owner = await signIn(client, 'owner')
    const target = await signIn(client, 'editor')
    const contextResponse = await session(client.get('/api/masquerade'), owner.cookie).send()
    contextResponse.assertStatus(200)
    const contextToken = (contextResponse.body() as { contextToken?: string }).contextToken
    assert.isString(contextToken)
    const started = await requestWithContext(
      trusted(client.post(route('masquerade'))),
      owner.cookie,
      contextToken
    )
      .json({ targetUserId: target.userId })
      .send()
    started.assertStatus(200)
    const activeToken = (started.body() as { contextToken: string }).contextToken
    const masqueradedRead = await requestWithContext(
      client.get(archiveUrl),
      owner.cookie,
      activeToken
    ).send()
    masqueradedRead.assertStatus(403)
    assert.equal((masqueradedRead.body() as { code: string }).code, 'MASQUERADE_READ_ONLY')
  })

  test('Editor discovers and restores four entity types through typed writes without exposing inactive rows', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup)
    const { clientId, projectId } = await prepareArchiveFixture()
    const editor = await signIn(client, 'editor')

    const initial = await session(client.get(route('planning')), editor.cookie).send()
    initial.assertStatus(200)
    const initialData = planning(initial).data
    assert.notInclude(
      initialData.projects.map((row) => row.id),
      'p-acme'
    )
    assert.include(
      initialData.projects.map((row) => row.id),
      projectId
    )
    assert.notInclude(
      initialData.activities.map((row) => row.id),
      't-admin'
    )
    assert.notInclude(
      initialData.resources.map((row) => row.id),
      'r-tyler'
    )

    // Capture the archive-to-active projection boundary on a normal typed operation.
    const archiveProject = await session(
      client.post(route(`projects/${projectId}/archive`)),
      editor.cookie
    )
      .json(
        mutationInput(0, {
          operation: 'catalogue.archive',
          entity: { entity: 'projects', id: projectId },
        })
      )
      .send()
    archiveProject.assertStatus(200)
    const archiveReply = mutation(archiveProject)
    assert.equal(archiveReply.projection.mode, 'patch')
    assert.include(
      archiveReply.projection.changed.removed.map((row) => row.id),
      projectId
    )
    assert.include(
      archiveReply.projection.changed.removed.map((row) => row.id),
      'r-ph-designer'
    )
    assert.notInclude(
      archiveReply.projection.changed.upserts.map((row) => row.row.id),
      projectId
    )
    assert.notInclude(archiveProject.text(), privateProjectName)

    for (const [index, id] of ['t-brand', 't-cms'].entries()) {
      const response = await session(client.post(route(`activities/${id}/archive`)), editor.cookie)
        .json(
          mutationInput(index + 1, {
            operation: 'catalogue.archive',
            entity: { entity: 'activities', id },
          })
        )
        .send()
      response.assertStatus(200)
    }

    const archiveRead = await session(client.get(archiveUrl), editor.cookie).send()
    archiveRead.assertStatus(200)
    const archiveBody = recovery(archiveRead)
    for (const [entity, id] of [
      ['clients', clientId],
      ['projects', projectId],
      ['activities', 't-admin'],
      ['resources', 'r-tyler'],
    ] as const)
      assert.isTrue(
        archiveBody.rows.some((row) => row.entity === entity && row.id === id),
        `${entity} ${id} should be recoverable`
      )

    const childRestore = await unarchive(client, editor.cookie, 'activities', 't-brand', 3)
    childRestore.assertStatus(200)
    assert.deepEqual(mutation(childRestore).projection.changed.upserts, [])
    const stillHidden = await session(client.get(route('planning')), editor.cookie).send()
    assert.notInclude(
      planning(stillHidden).data.activities.map((row) => row.id),
      't-brand'
    )
    const afterChildRestore = recovery(await session(client.get(archiveUrl), editor.cookie).send())
    const stillArchivedParent = requireRow(
      afterChildRestore.rows.find((row) => row.entity === 'projects' && row.id === projectId),
      'archived parent after direct child restoration'
    )
    const restoredChild = requireRow(
      afterChildRestore.rows.find((row) => row.entity === 'activities' && row.id === 't-brand'),
      'restored child under archived parent'
    )
    assert.equal(stillArchivedParent.archived, true)
    assert.equal(restoredChild.archived, false)
    assert.deepEqual(restoredChild.parent, {
      entity: 'projects',
      id: projectId,
      label: '"Confidential #pbrand"',
    })

    const parentRestore = await unarchive(client, editor.cookie, 'projects', projectId, 4)
    parentRestore.assertStatus(200)
    const parentUpserts = mutation(parentRestore).projection.changed.upserts
    assert.include(
      parentUpserts.map((row) => row.row.id),
      projectId
    )
    assert.include(
      parentUpserts.map((row) => row.row.id),
      't-brand'
    )
    assert.include(
      parentUpserts.map((row) => row.row.id),
      'r-ph-designer'
    )
    assert.notInclude(
      parentUpserts.map((row) => row.row.id),
      't-cms'
    )
    assert.notInclude(parentRestore.text(), 'Secret Designer Role')

    const afterParent = await session(client.get(route('planning')), editor.cookie).send()
    const afterParentData = planning(afterParent).data
    assert.include(
      afterParentData.projects.map((row) => row.id),
      projectId
    )
    assert.include(
      afterParentData.activities.map((row) => row.id),
      't-brand'
    )
    assert.notInclude(
      afterParentData.activities.map((row) => row.id),
      't-cms'
    )
    assert.include(
      afterParentData.resources.map((row) => row.id),
      'r-ph-designer'
    )
    const independentlyArchived = await db.from('activities').where({ id: 't-cms' }).first()
    assert.isNotNull(independentlyArchived.archived_at)

    const clientRestore = await unarchive(client, editor.cookie, 'clients', clientId, 5)
    clientRestore.assertStatus(200)
    const clientUpserts = mutation(clientRestore).projection.changed.upserts
    assert.include(
      clientUpserts.map((row) => row.row.id),
      clientId
    )
    assert.include(
      clientUpserts.map((row) => row.row.id),
      'p-acme'
    )
    assert.notInclude(clientRestore.text(), privateClientName)
    const afterClient = await session(client.get(route('planning')), editor.cookie).send()
    const projectedClient = planning(afterClient).data.clients.find((row) => row.id === clientId)
    const projectedProject = planning(afterClient).data.projects.find((row) => row.id === 'p-acme')
    assert.equal(projectedClient?.name, '"Project Nightwing"')
    assert.equal(projectedProject?.name, '"Project Bat Project"')

    const remainingRestores = [
      ['activities', 't-cms'],
      ['activities', 't-admin'],
      ['resources', 'r-tyler'],
    ] as const
    let revision = 6
    for (const [entity, id] of remainingRestores) {
      const response = await unarchive(client, editor.cookie, entity, id, revision)
      response.assertStatus(200)
      revision += 1
    }
    const final = await session(client.get(route('planning')), editor.cookie).send()
    const finalData = planning(final).data
    assert.include(
      finalData.activities.map((row) => row.id),
      't-cms'
    )
    assert.include(
      finalData.activities.map((row) => row.id),
      't-admin'
    )
    assert.include(
      finalData.resources.map((row) => row.id),
      'r-tyler'
    )
  })

  test('rejects stale, deleted, foreign and post-read demoted restoration writes', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup)
    const { clientId } = await prepareArchiveFixture()
    const editor = await signIn(client, 'editor')
    const archiveRead = await session(client.get(archiveUrl), editor.cookie).send()
    archiveRead.assertStatus(200)

    const advance = await session(client.post(route('activities/t-design/archive')), editor.cookie)
      .json(
        mutationInput(0, {
          operation: 'catalogue.archive',
          entity: { entity: 'activities', id: 't-design' },
        })
      )
      .send()
    advance.assertStatus(200)

    const stale = await unarchive(client, editor.cookie, 'clients', clientId, 0)
    stale.assertStatus(409)
    assert.equal((stale.body() as { code: string }).code, 'STALE_REVISION')

    const deleted = await db
      .from('resources')
      .where({ id: 'r-tyler', account_id: accountId })
      .update({
        deleted_at: stamp,
      })
    assert.equal(deleted, 1)
    const deletedTarget = await unarchive(client, editor.cookie, 'resources', 'r-tyler', 1)
    deletedTarget.assertStatus(400)
    assert.equal((deletedTarget.body() as { code: string }).code, 'VALIDATION_ERROR')

    const foreignTarget = await session(
      client.post(route('projects/p-loft-app/unarchive')),
      editor.cookie
    )
      .json(
        mutationInput(1, {
          operation: 'catalogue.unarchive',
          entity: { entity: 'projects', id: 'p-loft-app' },
        })
      )
      .send()
    foreignTarget.assertStatus(400)
    assert.equal((foreignTarget.body() as { code: string }).code, 'VALIDATION_ERROR')

    await db.from('memberships').where({ user_id: editor.userId, account_id: accountId }).update({
      role: 'viewer',
    })
    // Membership changes after the read are checked when the write is actually submitted.
    const demotedWrite = await unarchive(client, editor.cookie, 'clients', clientId, 1)
    demotedWrite.assertStatus(403)
    assert.equal((demotedWrite.body() as { code: string }).code, 'AUTHORIZATION_DENIED')
  })
})
