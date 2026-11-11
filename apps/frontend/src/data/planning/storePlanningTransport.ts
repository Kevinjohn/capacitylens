import type { PlanningTransport } from './planningCacheController';
import { createPlanningTransport } from './planningTransport';

/** Planning always uses the authenticated server; tests replace this construction seam. */
export function createStorePlanningTransport(): PlanningTransport {
  return createPlanningTransport();
}
