import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { InstallationCompanyService } from '#services/installation_company_service'
import { freshDatabase } from '#tests/helpers/fresh_database'
import { resetState } from '#tests/helpers/state_fixture'
import {
  createFixtureCompanyForOwner,
  resetAuthenticatedData,
} from '#tests/helpers/authenticated_data_fixture'
import { loggedInDataClient } from '#tests/helpers/data/logged_in_client'
import User from '#models/user'

const installationCompany = new InstallationCompanyService()

test.group('installation company', (group) => {
  group.setup(() => freshDatabase())

  test('an installation without a company has none to name', async ({ assert }) => {
    await resetState(false)
    assert.isTrue(await installationCompany.hasNoCompany())
    assert.isFalse(await installationCompany.hasMultipleCompanies())
    assert.isNull(await installationCompany.getInstallationCompanyId())
  })

  test('a single company is the installation company', async ({ assert }) => {
    await resetState('single')
    const [company] = await db.from('companies').select('id')
    assert.isFalse(await installationCompany.hasNoCompany())
    assert.isFalse(await installationCompany.hasMultipleCompanies())
    assert.equal(await installationCompany.getInstallationCompanyId(), String(company.id))
  })

  test('a second company is refused with one code', async ({ assert }) => {
    await resetState(true)
    assert.isFalse(await installationCompany.hasNoCompany())
    assert.isTrue(await installationCompany.hasMultipleCompanies())
    try {
      await installationCompany.getInstallationCompanyId()
      assert.fail('Expected the second company to be refused')
    } catch (error) {
      assert.include(error, {
        status: 409,
        code: 'MULTIPLE_COMPANIES',
        message:
          'This installation has more than one company. Accounts need a single-company database.',
      })
    }
  })

  test('fails closed on a multi-company directory without offering a selection', async ({
    client,
  }) => {
    const session = await resetAuthenticatedData(client, false)
    await createFixtureCompanyForOwner(session.userId, 'Wayne Enterprises')
    await createFixtureCompanyForOwner(session.userId, 'Stark Industries')
    const owner = loggedInDataClient(client, await User.findOrFail(session.userId))
    const directory = await owner.visit('api.companies.index').send()
    directory.assertStatus(409)
  })
})
