import { E2E_SCRIPT_TEST_SLOTS } from './e2eTestSlots.mjs'
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  PORT_LANE_CEILING,
  WORKER_SLOTS_PER_PORT_LANE,
  workerPorts,
  portsForPortLane,
  reservationCeiling,
  resolvePortLane,
  soloShare,
  testShare,
} from './ports.mjs'

test('port lane 0 reproduces the ports this repository bound before port lanes existed', () => {
  assert.deepEqual(portsForPortLane(0), {
    web: 5173,
    dbWeb: 5273,
    authWeb: 5373,
    dbApi: 8787,
    authApi: 8887,
    testHttp: 8987,
    preview: 4173,
    docsDev: 5900,
    docsPreview: 5910,
  })
})

test('no two services share a port anywhere in the port lane range', () => {
  const seen = new Map()
  const claim = (port, owner) => {
    assert.equal(
      seen.get(port),
      undefined,
      `${port} is claimed by both ${seen.get(port)} and ${owner}`
    )
    seen.set(port, owner)
  }
  for (let portLane = 0; portLane < PORT_LANE_CEILING; portLane += 1) {
    for (const [service, port] of Object.entries(portsForPortLane(portLane)))
      claim(port, `${service} port lane ${portLane}`)
    for (let slot = 0; slot < WORKER_SLOTS_PER_PORT_LANE; slot += 1)
      for (const [service, port] of Object.entries(workerPorts(portLane, slot)))
        claim(port, `${service} port lane ${portLane} slot ${slot}`)
  }
})

test('a port lane outside the ceiling is rejected rather than silently wrapped', () => {
  assert.throws(() => portsForPortLane(PORT_LANE_CEILING), RangeError)
  assert.throws(() => portsForPortLane(-1), RangeError)
  assert.throws(() => portsForPortLane(1.5), RangeError)
})

test('the port lane comes from the environment, defaulting to 0 when nothing claimed one', () => {
  assert.equal(resolvePortLane({}), 0)
  assert.equal(resolvePortLane({ CAPACITYLENS_PORT_LANE: '' }), 0)
  assert.equal(resolvePortLane({ CAPACITYLENS_PORT_LANE: '7' }), 7)
  assert.throws(() => resolvePortLane({ CAPACITYLENS_PORT_LANE: 'ten' }), RangeError)
  assert.throws(() => resolvePortLane({ CAPACITYLENS_PORT_LANE: '10' }), RangeError)
})

test('a run outside a port lane gets the same ceiling a solo claim would', () => {
  assert.equal(testShare({}), reservationCeiling())
  assert.equal(testShare({ CAPACITYLENS_TEST_SHARE: '3' }), 3)
  assert.throws(() => testShare({ CAPACITYLENS_TEST_SHARE: '0' }), RangeError)
  assert.throws(() => testShare({ CAPACITYLENS_TEST_SHARE: '-2' }), RangeError)
})

test('the pool leaves a core for everything that is not a test worker, and never drops below one', () => {
  assert.equal(soloShare(10), 9)
  assert.equal(soloShare(1), 1)
  assert.equal(reservationCeiling(10), 5)
  assert.equal(reservationCeiling(1), 1)
})

test('worker slots are bounded and keep each port lane in its reserved range', () => {
  assert.deepEqual(workerPorts(0, 0), { api: 10000 })
  assert.deepEqual(workerPorts(9, 49), { api: 10499 })
  for (const slot of [-1, 0.5, 50, NaN, Infinity])
    assert.throws(() => workerPorts(0, slot), RangeError)
  assert.throws(() => workerPorts(10, 0), RangeError)
})

test('script fixtures use distinct slots within the claimed port lane', () => {
  const slots = Object.values(E2E_SCRIPT_TEST_SLOTS)
  assert.equal(new Set(slots).size, slots.length)
  for (const slot of slots) {
    assert.ok(Number.isInteger(slot) && slot >= 0 && slot < WORKER_SLOTS_PER_PORT_LANE)
  }
})
