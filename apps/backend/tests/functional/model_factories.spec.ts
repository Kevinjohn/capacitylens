import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { freshDatabase } from '#tests/helpers/fresh_database'
import { ActivityFactory } from '#database/factories/activity_factory'
import { AllocationFactory } from '#database/factories/allocation_factory'
import { ClientFactory } from '#database/factories/client_factory'
import { ClosureFactory } from '#database/factories/closure_factory'
import { CompanyFactory } from '#database/factories/company_factory'
import { DisciplineFactory } from '#database/factories/discipline_factory'
import { PhaseFactory } from '#database/factories/phase_factory'
import { ProjectFactory } from '#database/factories/project_factory'
import { ResourceFactory } from '#database/factories/resource_factory'
import { TimeOffFactory } from '#database/factories/time_off_factory'
import { UserFactory } from '#database/factories/user_factory'

test.group('Model factories', (group) => {
  group.each.setup(() => freshDatabase())

  test('build one row of every product model in one company', async ({ assert }) => {
    const company = await CompanyFactory.create()
    const companyId = company.id
    const client = await ClientFactory.merge({ companyId }).create()
    const project = await ProjectFactory.merge({ companyId, clientId: client.id }).create()
    const phase = await PhaseFactory.merge({ companyId, projectId: project.id }).create()
    const activity = await ActivityFactory.merge({
      companyId,
      projectId: project.id,
      phaseId: phase.id,
    }).create()
    const discipline = await DisciplineFactory.merge({ companyId }).create()
    const resource = await ResourceFactory.merge({
      companyId,
      disciplineId: discipline.id,
    }).create()
    await AllocationFactory.merge({
      companyId,
      resourceId: resource.id,
      activityId: activity.id,
      projectId: project.id,
    }).create()
    await ClosureFactory.merge({ companyId }).create()
    await TimeOffFactory.merge({ companyId, resourceId: resource.id }).create()
    const user = await db.transaction((trx) => UserFactory.client(trx).create())
    const stored = await db.from('users').where('id', user.id).firstOrFail()
    assert.isString(stored.email_verified_at)
    assert.isNull(stored.unverified_email)

    for (const table of [
      'companies',
      'clients',
      'projects',
      'phases',
      'activities',
      'disciplines',
      'resources',
      'allocations',
      'closures',
      'time_off',
      'users',
    ]) {
      const [{ total }] = await db.from(table).count('* as total')
      assert.equal(Number(total), 1, table)
    }
  })
})
