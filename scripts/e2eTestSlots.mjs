import { WORKER_SLOTS_PER_LANE } from './ports.mjs';

/** Independent script-test files share one claimed lane and each use their own slot. */
export const E2E_SCRIPT_TEST_SLOTS = Object.freeze({
  runtime: WORKER_SLOTS_PER_LANE - 1,
  proxy: WORKER_SLOTS_PER_LANE - 2,
  reset: WORKER_SLOTS_PER_LANE - 3,
});
