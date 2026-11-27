import { test } from '@japa/runner'
import { FIXTURE_RESOURCE_EXTERNAL } from '@capacitylens/shared/data/fixtures'
import { buildSaveAdvisory } from '#services/planning/save_advisory'
import type { PlanningIntent } from '#validators/planning/contracts'
import {
  advisoryCompanyData,
  createSaved,
  fixtureCompanyId,
} from '#tests/helpers/unit/planning_fixtures'

test.group('allocation save advisory', () => {
  test('counts the saved row against the rest of its resource load', ({ assert }) => {
    assert.deepEqual(
      buildSaveAdvisory(createSaved, advisoryCompanyData('hourly'), fixtureCompanyId),
      {
        advisory: { overDays: 1, timeOffDays: 0 },
      }
    )
  })

  test('projects blocks-mode load instead of the stored hours', ({ assert }) => {
    assert.deepEqual(
      buildSaveAdvisory(createSaved, advisoryCompanyData('blocks'), fixtureCompanyId),
      {
        advisory: { overDays: 0, timeOffDays: 0 },
      }
    )
  })

  test('reports nothing for an external resource', ({ assert }) => {
    assert.deepEqual(
      buildSaveAdvisory(
        createSaved,
        advisoryCompanyData('hourly', FIXTURE_RESOURCE_EXTERNAL.id),
        fixtureCompanyId
      ),
      { advisory: { overDays: 0, timeOffDays: 0 } }
    )
  })

  test('carries no advisory for a write that is not an allocation save', ({ assert }) => {
    const deletion = { operation: 'allocation.delete', id: 'saved' } as PlanningIntent
    assert.deepEqual(
      buildSaveAdvisory(deletion, advisoryCompanyData('hourly'), fixtureCompanyId),
      {}
    )
  })
})
