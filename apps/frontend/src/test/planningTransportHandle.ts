import type { PlanningTransport } from '@/data/planning/planningCacheController';
import type { AppData } from '@capacitylens/shared/types/entities';

interface TestPlanningTransportHandle {
  transport: PlanningTransport;
  readData: () => AppData;
  reset: (companyId: string, data: AppData) => void;
  updateSource: (data: AppData) => void;
}

let handle: TestPlanningTransportHandle | undefined;

/** Register the transport returned to this module instance's store. */
export function setPlanningTransportHandle(next: TestPlanningTransportHandle): void {
  handle = next;
}

/** Return the exact transport owned by the fixture store. */
export function getPlanningTransportHandle(): PlanningTransport {
  if (!handle) throw new Error('The planning transport has not been initialized.');
  return handle.transport;
}

/** Reset the owned transport, refusing a handle from a different store module instance. */
export function resetPlanningTransport(
  companyId: string,
  data: AppData,
  currentData: AppData,
): void {
  if (!handle || handle.readData() !== currentData) {
    throw new Error('The planning transport does not belong to this fixture store.');
  }
  handle.reset(companyId, data);
}

/** Update fixture data visible to future reads without clearing planning history. */
export function updatePlanningFixtureSource(data: AppData, currentData: AppData): void {
  if (!handle || handle.readData() !== currentData) {
    throw new Error('The planning transport does not belong to this fixture store.');
  }
  handle.updateSource(data);
}
