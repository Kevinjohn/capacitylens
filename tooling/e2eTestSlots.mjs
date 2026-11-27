import { WORKER_SLOTS_PER_PORT_LANE } from './ports.mjs'

/** Independent script-test files share one claimed port lane and each use their own slot. */
export const E2E_SCRIPT_TEST_SLOTS = Object.freeze({
  runtime: WORKER_SLOTS_PER_PORT_LANE - 1,
  reset: WORKER_SLOTS_PER_PORT_LANE - 3,
  serverBoundary: WORKER_SLOTS_PER_PORT_LANE - 4,
})
