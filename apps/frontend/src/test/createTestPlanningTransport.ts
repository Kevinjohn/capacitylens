import type { AppData } from '@capacitylens/shared/types/entities';
import type { PlanningTransport } from '@/data/planning/planningCacheController';
import { createVolatilePlanningTransport } from '@/data/planning/volatilePlanningTransport';
import { setPlanningTransportHandle } from './planningTransportHandle';

/** Own the fixture reset source until its first canonical read publishes the company. */
export function createTestPlanningTransport(
  readData: () => AppData,
  wrap: (transport: PlanningTransport) => PlanningTransport = (transport) => transport,
): PlanningTransport {
  let pendingReset: { data: AppData } | undefined;
  const engine = createVolatilePlanningTransport(() => pendingReset?.data ?? readData());
  const resetCompany = engine.resetAfterDemoImport;
  if (!resetCompany) throw new Error('The fixture transport must support company resets.');
  const transport = wrap({
    ...engine,
    read: async (...args) => {
      const captured = pendingReset;
      try {
        return await engine.read(...args);
      } finally {
        if (pendingReset === captured) pendingReset = undefined;
      }
    },
  });
  setPlanningTransportHandle({
    transport,
    readData,
    reset(companyId, data) {
      pendingReset = { data };
      resetCompany(companyId, data);
    },
  });
  return transport;
}
