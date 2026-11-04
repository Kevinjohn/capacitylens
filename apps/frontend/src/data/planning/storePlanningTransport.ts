import type { AppData } from '@capacitylens/shared/types/entities';
import { isServerConfigured } from '@/data/apiConfig';
import type { PlanningTransport } from './planningCacheController';
import { createPlanningTransport } from './planningTransport';
import { createVolatilePlanningTransport } from './volatilePlanningTransport';

/** Server builds use the typed API; demo builds keep changes in page memory. */
export function createStorePlanningTransport(readData: () => AppData): PlanningTransport {
  return isServerConfigured()
    ? createPlanningTransport()
    : createVolatilePlanningTransport(readData);
}
