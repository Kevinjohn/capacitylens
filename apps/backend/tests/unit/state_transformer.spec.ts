import { test } from '@japa/runner'
import { transformState } from '#transformers/state_transformer'
import {
  FIXTURE_ACCOUNT,
  FIXTURE_ACTIVITY,
  FIXTURE_ALLOCATION,
  FIXTURE_CLIENT,
  FIXTURE_CLOSURE,
  FIXTURE_DISCIPLINE,
  FIXTURE_PHASE,
  FIXTURE_PROJECT,
  FIXTURE_RESOURCE,
  FIXTURE_TIMEOFF,
} from '@capacitylens/shared/data/fixtures'

const data = {
  accounts: [FIXTURE_ACCOUNT],
  clients: [FIXTURE_CLIENT],
  disciplines: [FIXTURE_DISCIPLINE],
  projects: [FIXTURE_PROJECT],
  phases: [FIXTURE_PHASE],
  resources: [FIXTURE_RESOURCE],
  activities: [FIXTURE_ACTIVITY],
  allocations: [FIXTURE_ALLOCATION],
  timeOff: [FIXTURE_TIMEOFF],
  closures: [FIXTURE_CLOSURE],
}

test('projects private names and time-off notes for every role', ({ assert }) => {
  for (const role of ['admin', 'editor', 'viewer'] as const) {
    const projected = transformState(data, FIXTURE_ACCOUNT.id, role)
    assert.equal(projected.clients[0]?.name, '"Fixture Nightwing"')
    assert.property(projected.clients[0]!, 'codeName')
    assert.isNull(projected.clients[0]?.codeName)
    assert.equal(projected.projects[0]?.name, '"Fixture Aurora"')
    assert.property(projected.projects[0]!, 'codeName')
    assert.isNull(projected.projects[0]?.codeName)
    assert.equal(projected.timeOff[0]?.note, role === 'admin' ? FIXTURE_TIMEOFF.note : null)
  }
  const owner = transformState(data, FIXTURE_ACCOUNT.id, 'owner')
  assert.equal(owner.clients[0]?.name, FIXTURE_CLIENT.name)
  assert.equal(owner.clients[0]?.codeName, FIXTURE_CLIENT.codeName)
  assert.equal(owner.timeOff[0]?.note, FIXTURE_TIMEOFF.note)
})
