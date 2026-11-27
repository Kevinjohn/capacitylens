import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { freshDatabase } from '#tests/helpers/fresh_database'
import {
  companyId,
  configureAuth,
  resetPlanningFixture,
  intentSession,
  loginAsMember,
  signIn,
  trusted,
  validationSentence,
} from '#tests/functional/planning/helpers'
import {
  privateClientName,
  privateProjectName,
  recovery,
  planning,
  requestWithContext,
  restore,
  requireRow,
  prepareArchiveFixture,
} from '#tests/helpers/planning/archive_recovery'
import { mutationInput } from '#tests/helpers/planning/mutations'

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
    const actor = await loginAsMember('editor')

    for (const role of ['editor', 'admin', 'owner'] as const) {
      await db
        .from('memberships')
        .where({ user_id: actor.userId, scope_id: companyId })
        .update({ role })
      const response = await intentSession(
        client.visit('api.planning_archive.show', { companyId }),
        actor.cookie
      ).send()
      assert.equal(response.status(), 200, response.text())
      const body = recovery(response)
      assert.equal(body.companyId, companyId)
      assert.deepEqual(Object.keys((response.body() as { data: unknown }).data as object).sort(), [
        'companyId',
        'rows',
      ])

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
    const viewer = await loginAsMember('viewer')
    const viewerRead = await intentSession(
      client.visit('api.planning_archive.show', { companyId }),
      viewer.cookie
    ).send()
    viewerRead.assertStatus(403)

    const editor = await loginAsMember('editor')
    const foreignRead = await intentSession(
      client.visit('api.planning_archive.show', { companyId: 'a-loft' }),
      editor.cookie
    ).send()
    foreignRead.assertStatus(403)
    const inactiveRead = await intentSession(
      client.visit('api.planning_archive.show', { companyId }),
      editor.cookie
    ).send()
    inactiveRead.assertStatus(200)
    await db.from('memberships').where({ user_id: editor.userId, scope_id: companyId }).update({
      status: 'suspended',
    })
    const removedRead = await intentSession(
      client.visit('api.planning_archive.show', { companyId }),
      editor.cookie
    ).send()
    removedRead.assertStatus(403)

    const invalidSessionActor = await signIn(client, 'editor')
    await db.from('account_sessions').where({ user_id: invalidSessionActor.userId }).delete()
    const invalidSession = await intentSession(
      client.visit('api.planning_archive.show', { companyId }),
      invalidSessionActor.cookie
    ).send()
    invalidSession.assertStatus(401)

    const owner = await signIn(client, 'owner')
    const target = await signIn(client, 'editor')
    const contextResponse = await intentSession(
      client.visit('api.masquerade.show'),
      owner.cookie
    ).send()
    contextResponse.assertStatus(200)
    const masqueradeToken = (contextResponse.body()!.data as { masqueradeToken?: string })
      .masqueradeToken
    assert.isString(masqueradeToken)
    const started = await requestWithContext(
      trusted(client.visit('api.masquerade.store', { companyId })),
      owner.cookie,
      masqueradeToken
    )
      .json({ targetUserId: target.userId })
      .send()
    started.assertStatus(200)
    const activeToken = ((started.body() as { data: unknown }).data as { masqueradeToken: string })
      .masqueradeToken
    const masqueradedRead = await requestWithContext(
      client.visit('api.planning_archive.show', { companyId }),
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
    const editor = await loginAsMember('editor')

    const initial = await intentSession(
      client.visit('api.planning.show', { companyId }),
      editor.cookie
    ).send()
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
    const archiveProject = await intentSession(
      client.visit('api.planning_mutations.store', { companyId }),
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
    assert.notInclude(archiveProject.text(), privateProjectName)
    const afterArchive = await intentSession(
      client.visit('api.planning.show', { companyId }),
      editor.cookie
    ).send()
    afterArchive.assertStatus(200)
    const afterArchiveData = planning(afterArchive).data
    assert.notInclude(
      afterArchiveData.projects.map((row) => row.id),
      projectId
    )
    assert.notInclude(
      afterArchiveData.resources.map((row) => row.id),
      'r-ph-designer'
    )
    assert.notInclude(afterArchive.text(), privateProjectName)

    for (const [index, id] of ['t-brand', 't-cms'].entries()) {
      const response = await intentSession(
        client.visit('api.planning_mutations.store', { companyId }),
        editor.cookie
      )
        .json(
          mutationInput(index + 1, {
            operation: 'catalogue.archive',
            entity: { entity: 'activities', id },
          })
        )
        .send()
      response.assertStatus(200)
      // t-brand sits under the project archived above, so archiving it hides nothing more.
      if (id === 't-brand')
        assert.deepEqual(
          ((response.body() as { data: unknown }).data as { archived?: unknown }).archived,
          {
            projects: 0,
            phases: 0,
            activities: 0,
            allocations: 0,
            timeOff: 0,
          }
        )
    }

    const archiveRead = await intentSession(
      client.visit('api.planning_archive.show', { companyId }),
      editor.cookie
    ).send()
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

    const childRestore = await restore(client, editor.cookie, 'activities', 't-brand', 3)
    childRestore.assertStatus(200)
    const stillHidden = await intentSession(
      client.visit('api.planning.show', { companyId }),
      editor.cookie
    ).send()
    assert.notInclude(
      planning(stillHidden).data.activities.map((row) => row.id),
      't-brand'
    )
    const afterChildRestore = recovery(
      await intentSession(
        client.visit('api.planning_archive.show', { companyId }),
        editor.cookie
      ).send()
    )
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

    const parentRestore = await restore(client, editor.cookie, 'projects', projectId, 4)
    parentRestore.assertStatus(200)
    assert.notInclude(parentRestore.text(), 'Secret Designer Role')

    const afterParent = await intentSession(
      client.visit('api.planning.show', { companyId }),
      editor.cookie
    ).send()
    assert.notInclude(afterParent.text(), 'Secret Designer Role')
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

    const clientRestore = await restore(client, editor.cookie, 'clients', clientId, 5)
    clientRestore.assertStatus(200)
    assert.notInclude(clientRestore.text(), privateClientName)
    const afterClient = await intentSession(
      client.visit('api.planning.show', { companyId }),
      editor.cookie
    ).send()
    assert.notInclude(afterClient.text(), privateClientName)
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
      const response = await restore(client, editor.cookie, entity, id, revision)
      response.assertStatus(200)
      revision += 1
    }
    const final = await intentSession(
      client.visit('api.planning.show', { companyId }),
      editor.cookie
    ).send()
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
    const editor = await loginAsMember('editor')
    const archiveRead = await intentSession(
      client.visit('api.planning_archive.show', { companyId }),
      editor.cookie
    ).send()
    archiveRead.assertStatus(200)

    const advance = await intentSession(
      client.visit('api.planning_mutations.store', { companyId }),
      editor.cookie
    )
      .json(
        mutationInput(0, {
          operation: 'catalogue.archive',
          entity: { entity: 'activities', id: 't-design' },
        })
      )
      .send()
    advance.assertStatus(200)

    const stale = await restore(client, editor.cookie, 'clients', clientId, 0)
    stale.assertStatus(409)
    assert.equal((stale.body() as { code: string }).code, 'STALE_REVISION')

    const foreignTarget = await intentSession(
      client.visit('api.planning_mutations.store', { companyId }),
      editor.cookie
    )
      .json(
        mutationInput(1, {
          operation: 'catalogue.restore',
          entity: { entity: 'projects', id: 'p-loft-app' },
        })
      )
      .send()
    foreignTarget.assertStatus(422)
    assert.isString(validationSentence(foreignTarget))

    await db.from('memberships').where({ user_id: editor.userId, scope_id: companyId }).update({
      role: 'viewer',
    })
    // Membership changes after the read are checked when the write is actually submitted.
    const demotedWrite = await restore(client, editor.cookie, 'clients', clientId, 1)
    demotedWrite.assertStatus(403)
    assert.equal((demotedWrite.body() as { code: string }).code, 'AUTHORIZATION_DENIED')
  })
})
