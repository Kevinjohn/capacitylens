import { test } from '@japa/runner'
import { transformState } from '#transformers/state_transformer'
import { resolveDisplayName } from '#services/planning/restricted_fields'
import {
  FIXTURE_COMPANY,
  FIXTURE_ACTIVITY,
  FIXTURE_ALLOCATION,
  FIXTURE_CLIENT,
  FIXTURE_CLOSURE,
  FIXTURE_DISCIPLINE,
  FIXTURE_PHASE,
  FIXTURE_PROJECT,
  FIXTURE_RESOURCE,
  FIXTURE_TIME_OFF,
} from '@capacitylens/shared/data/fixtures'

const data = {
  companies: [FIXTURE_COMPANY],
  clients: [FIXTURE_CLIENT],
  disciplines: [FIXTURE_DISCIPLINE],
  projects: [FIXTURE_PROJECT],
  phases: [FIXTURE_PHASE],
  resources: [FIXTURE_RESOURCE],
  activities: [FIXTURE_ACTIVITY],
  allocations: [FIXTURE_ALLOCATION],
  timeOff: [FIXTURE_TIME_OFF],
  closures: [FIXTURE_CLOSURE],
}

test.group('state transformer', () => {
  test('projects private names and time-off notes for every role', ({ assert }) => {
    for (const role of ['admin', 'editor', 'viewer'] as const) {
      const projected = transformState(data, FIXTURE_COMPANY.id, role)
      assert.equal(projected.clients[0]?.name, '"Fixture Nightwing"')
      assert.property(projected.clients[0]!, 'codeName')
      assert.isNull(projected.clients[0]?.codeName)
      assert.equal(projected.projects[0]?.name, '"Fixture Aurora"')
      assert.property(projected.projects[0]!, 'codeName')
      assert.isNull(projected.projects[0]?.codeName)
      assert.equal(projected.timeOff[0]?.note, role === 'admin' ? FIXTURE_TIME_OFF.note : null)
    }
    const owner = transformState(data, FIXTURE_COMPANY.id, 'owner')
    assert.equal(owner.clients[0]?.name, FIXTURE_CLIENT.name)
    assert.equal(owner.clients[0]?.codeName, FIXTURE_CLIENT.codeName)
    assert.equal(owner.timeOff[0]?.note, FIXTURE_TIME_OFF.note)
  })

  test('sends one display name per client and project for the reader role', ({ assert }) => {
    const publicClient = {
      ...FIXTURE_CLIENT,
      id: 'fix-c2',
      name: 'Daily Planet',
      isPrivate: null,
      codeName: null,
    }
    const publicProject = {
      ...FIXTURE_PROJECT,
      id: 'fix-p2',
      clientId: 'fix-c2',
      name: 'Daily Planet Launch',
      isPrivate: null,
      codeName: null,
    }
    const mixed = {
      ...data,
      clients: [FIXTURE_CLIENT, publicClient],
      projects: [FIXTURE_PROJECT, publicProject],
    }
    const labels = (role: 'owner' | 'admin' | 'editor' | 'viewer') => {
      const projected = transformState(mixed, FIXTURE_COMPANY.id, role)
      return [...projected.clients, ...projected.projects].map((row) => row.displayName)
    }
    assert.deepEqual(labels('owner'), [
      'Fixture Nightwing',
      'Daily Planet',
      'Fixture Aurora',
      'Daily Planet Launch',
    ])
    for (const role of ['admin', 'editor', 'viewer'] as const) {
      assert.deepEqual(labels(role), [
        '"Fixture Nightwing"',
        'Daily Planet',
        '"Fixture Aurora"',
        'Daily Planet Launch',
      ])
    }
  })

  test('orders by a trimmed code name and ignores a blank one', ({ assert }) => {
    assert.equal(
      resolveDisplayName({ name: 'Wayne Enterprises', codeName: '  Nightwing  ' }),
      'Nightwing'
    )
    assert.equal(
      resolveDisplayName({ name: 'Wayne Enterprises', codeName: '   ' }),
      'Wayne Enterprises'
    )
    assert.equal(resolveDisplayName({ name: '"Nightwing"' }), '"Nightwing"')
  })
})
