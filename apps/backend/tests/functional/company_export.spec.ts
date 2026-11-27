import { test } from '@japa/runner'
import {
  archiveResource,
  resetLoggedInDataOwner,
  roles,
  setRole,
} from '#tests/helpers/data/data_owner'
import { freshDatabase } from '#tests/helpers/fresh_database'
import db from '@adonisjs/lucid/services/db'
import { buildCompanyExport, serializeCompanyExport } from '@capacitylens/shared/data/companyExport'
import { transformState } from '#transformers/state_transformer'
import { readState } from '#tests/helpers/state_fixture'

test.group('company export download', (group) => {
  group.setup(() => freshDatabase())

  test("serves the role's projected export document", async ({ client, assert }) => {
    const signedIn = await resetLoggedInDataOwner(client)
    client = signedIn.client
    await archiveResource()
    await db.from('companies').where('id', 'a-studio').update({ date_style: 'month-day' })
    for (const role of roles) {
      await setRole(signedIn.userId, role)
      const response = await client
        .visit('api.company_exports.show', { companyId: 'a-studio' })
        .send()
      response.assertStatus(200)
      assert.equal(
        response.header('content-disposition'),
        'attachment; filename="capacitylens-data.json"',
        role
      )
      const inactive = role === 'owner' || role === 'admin'
      const expected = serializeCompanyExport(
        buildCompanyExport(
          transformState(await readState('a-studio', inactive), 'a-studio', role),
          {
            companyId: 'a-studio',
            completeness: role === 'owner' ? 'full' : 'redacted',
          }
        )
      )
      assert.equal(response.text(), expected, role)
      assert.include(response.text(), '"dateStyle": "month-day"', role)
    }
  })

  test("labels only the Owner's export full", async ({ client, assert }) => {
    const signedIn = await resetLoggedInDataOwner(client)
    client = signedIn.client
    for (const role of roles) {
      await setRole(signedIn.userId, role)
      const response = await client
        .visit('api.company_exports.show', { companyId: 'a-studio' })
        .send()
      response.assertStatus(200)
      const document = JSON.parse(response.text()) as { completeness: string }
      assert.equal(document.completeness, role === 'owner' ? 'full' : 'redacted', role)
    }
  })

  test('includes archived rows only for Owner and Admin', async ({ client, assert }) => {
    const signedIn = await resetLoggedInDataOwner(client)
    client = signedIn.client
    const archivedId = await archiveResource()
    for (const role of roles) {
      await setRole(signedIn.userId, role)
      const response = await client
        .visit('api.company_exports.show', { companyId: 'a-studio' })
        .send()
      response.assertStatus(200)
      const document = JSON.parse(response.text()) as { data: { resources: { id: string }[] } }
      const ids = document.data.resources.map((row) => row.id)
      assert.equal(ids.includes(archivedId), role === 'owner' || role === 'admin', role)
    }
  })

  test('refuses a company the caller does not belong to', async ({ client, assert }) => {
    const signedIn = await resetLoggedInDataOwner(client)
    client = signedIn.client
    await db.from('memberships').where({ user_id: signedIn.userId, scope_id: 'a-loft' }).delete()
    const response = await client.visit('api.company_exports.show', { companyId: 'a-loft' }).send()
    response.assertStatus(403)
    assert.equal((response.body() as unknown as { code: string }).code, 'ACCOUNT_MEMBERSHIP_LOST')
  })

  test('refuses an export that fails validation with its message', async ({ client, assert }) => {
    const signedIn = await resetLoggedInDataOwner(client)
    client = signedIn.client
    const placeholder = await db
      .from('resources')
      .where('company_id', 'a-studio')
      .whereNot('kind', 'person')
      .first()
    await db
      .from('resources')
      .where('id', placeholder.id)
      .update({ avatar_url: 'https://example.test/oracle.png' })
    const response = await client
      .visit('api.company_exports.show', { companyId: 'a-studio' })
      .send()
    response.assertStatus(400)
    assert.match(
      (response.body() as unknown as { error: string }).error,
      /avatarUrl: only a person may have an avatar URL$/
    )
  })
})
