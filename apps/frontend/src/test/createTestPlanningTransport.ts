import type { PlanningTransport } from '@/data/planning/planningCacheController';
import { StubPlanningTransport } from './planning/stubPlanningTransport';
import { setPlanningTransportHandle } from './planningTransportHandle';

/** Register the controlled transport returned to the fixture store, including custom response wrappers. */
export function createTestPlanningTransport(
  wrap: (transport: PlanningTransport) => PlanningTransport = (transport) => transport,
): PlanningTransport {
  const stub = new StubPlanningTransport();
  const transport = wrap({
    read: stub.read.bind(stub),
    execute: stub.execute.bind(stub),
    lookup: stub.lookup.bind(stub),
  });
  setPlanningTransportHandle({
    transport,
    stub,
  });
  return transport;
}
