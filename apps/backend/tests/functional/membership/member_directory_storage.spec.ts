import { test } from '@japa/runner'
import app from '@adonisjs/core/services/app'
import db from '@adonisjs/lucid/services/db'
import { MemberDirectoryService } from '#services/membership/member_directory_service'
import { resetState } from '#tests/helpers/state_fixture'
import { createFixtureCompanyForOwner } from '#tests/helpers/authenticated_data_fixture'
import { createIdentity } from '#tests/helpers/identities'
import { freshDatabase } from '#tests/helpers/fresh_database'
import {
  corruptions,
  directoryCompanyId,
  directoryStamp,
  memberDirectoryFixture,
  ownerGet,
  readDirectoryMemberEntry,
  readProductState,
  writeCorruption,
} from '#tests/helpers/membership/member_directory'

test.group('member directory malformed storage', (group) => {
  group.setup(() => freshDatabase())
  group.each.setup(async () => {
    await resetState(false)
    await db.from('account_admissions').delete()
    await db.from('account_invitations').delete()
    await db.from('adonis_sessions').delete()
    await db.from('memberships').delete()
    await db.from('users').delete()
  })

  test('rejects corrupted company rows at the service and authenticated HTTP boundary', async ({
    client,
    assert,
  }) => {
    const { ownerCookie, ownerId, memberId, masqueradeToken } = await memberDirectoryFixture(client)
    const baseline = await ownerGet({ client, ownerCookie, masqueradeToken }).send()
    baseline.assertStatus(200)
    assert.deepInclude(
      readDirectoryMemberEntry((baseline.body() as { data: unknown }).data, memberId),
      {
        userId: memberId,
        role: 'editor',
        status: 'active',
        manage: true,
      }
    )

    const memberDirectory = await app.container.make(MemberDirectoryService)
    for (const corruption of corruptions) {
      await writeCorruption(corruption, memberId)
      const beforeRead = await readProductState()
      await assert.rejects(
        () =>
          db.transaction((trx) =>
            memberDirectory.read(trx, directoryCompanyId, { actorId: ownerId, role: 'owner' })
          ),
        Error,
        new RegExp('^' + corruption.checkMessage.replace('.', '\\.') + '$'),
        `${corruption.label} must reach its own service check`
      )
      const failed = await ownerGet({ client, ownerCookie, masqueradeToken }).send()
      failed.assertStatus(500)
      // Outside production the 500 carries the service's own message, never the stored value.
      assert.notInclude(JSON.stringify(failed.body()), corruption.invalidValue)
      assert.deepEqual(
        await readProductState(),
        beforeRead,
        `${corruption.label} read must not repair or write product state`
      )

      await db.transaction(async (trx) => {
        await trx
          .from('memberships')
          .where({ scope_id: directoryCompanyId, user_id: memberId })
          .update({ [corruption.column]: corruption.validValue })
      })
      const restored = await ownerGet({ client, ownerCookie, masqueradeToken }).send()
      restored.assertStatus(200)
      assert.deepInclude(
        readDirectoryMemberEntry((restored.body() as { data: unknown }).data, memberId),
        {
          userId: memberId,
          role: 'editor',
          status: 'active',
          manage: true,
        }
      )
    }
  })

  test('ignores malformed rows from another company', async ({ client, assert }) => {
    const { ownerCookie, ownerId, masqueradeToken } = await memberDirectoryFixture(client)
    const otherCompanyId = 'member-directory-storage-other'
    await createFixtureCompanyForOwner(ownerId, 'Daily Planet', otherCompanyId)
    const foreignMemberId = await createIdentity('lex.luthor@dailyplanet.example', {
      name: 'Lex Luthor',
    })
    await db.transaction(async (trx) => {
      await trx.table('memberships').insert({
        scope_id: otherCompanyId,
        user_id: foreignMemberId,
        role: 'foreign-invalid-role-sentinel',
        status: 'foreign-invalid-status-sentinel',
        created_at: directoryStamp,
        updated_at: directoryStamp,
      })
    })

    const isolated = await ownerGet({ client, ownerCookie, masqueradeToken }).send()
    isolated.assertStatus(200)
    assert.notInclude(JSON.stringify((isolated.body() as { data: unknown }).data), foreignMemberId)
    assert.notInclude(
      JSON.stringify((isolated.body() as { data: unknown }).data),
      'foreign-invalid-role-sentinel'
    )
    assert.notInclude(
      JSON.stringify((isolated.body() as { data: unknown }).data),
      'foreign-invalid-status-sentinel'
    )
  })
})
