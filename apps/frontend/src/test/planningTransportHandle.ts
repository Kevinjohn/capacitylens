import type { PlanningTransport } from '@/data/planning/planningCacheController';
import type { AppData } from '@capacitylens/shared/types/entities';
import type { StubPlanningTransport } from './planning/stubPlanningTransport';

interface TestPlanningTransportHandle {
  transport: PlanningTransport;
  stub: StubPlanningTransport;
  owner?: object;
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

/** Claim the handle for this fixture store, refusing one owned by a different module instance. */
function ownedStub(owner: object): StubPlanningTransport {
  if (!handle || (handle.owner !== undefined && handle.owner !== owner)) {
    throw new Error('The planning transport does not belong to this fixture store.');
  }
  handle.owner = owner;
  return handle.stub;
}

/** Reset the owned transport, refusing a handle from a different store module instance. */
export function resetPlanningTransport(companyId: string, data: AppData, owner: object): void {
  ownedStub(owner).reset(companyId, data);
}

/** Update the fixture transport's canonical rows without clearing history or queued responses. */
export function updatePlanningFixtureSource(data: AppData, owner: object): void {
  ownedStub(owner).updateSource(data);
}

/** Return the fixture's explicit response controls. */
export function getStubPlanningTransport(): StubPlanningTransport {
  if (!handle) throw new Error('The planning transport has not been initialized.');
  return handle.stub;
}
