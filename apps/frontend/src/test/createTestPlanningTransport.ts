import type { AppData } from '@capacitylens/shared/types/entities';
import { emptyAppData, SCOPED_KEYS } from '@capacitylens/shared/types/entities';
import type { PlanningTransport } from '@/data/planning/planningCacheController';
import { applyProjection } from '@/data/planning/planningReceipts';
import { createVolatilePlanningTransport } from '@/data/planning/volatilePlanningTransport';
import { setPlanningTransportHandle } from './planningTransportHandle';

function replaceCompanyData(source: AppData, companyData: AppData, companyId: string): AppData {
  const next: AppData = {
    ...source,
    accounts: [
      ...source.accounts.filter(({ id }) => id !== companyId),
      ...companyData.accounts.filter(({ id }) => id === companyId),
    ],
  };
  for (const key of SCOPED_KEYS) {
    Object.assign(next, {
      [key]: [
        ...source[key].filter((row) => row.accountId !== companyId),
        ...companyData[key].filter((row) => row.accountId === companyId),
      ],
    });
  }
  return next;
}

/** Own fixture data as the page-memory source until reset or direct fixture replacement. */
export function createTestPlanningTransport(
  readData: () => AppData,
  wrap: (transport: PlanningTransport) => PlanningTransport = (transport) => transport,
): PlanningTransport {
  let source = emptyAppData();
  let resetGeneration = 0;
  const engine = createVolatilePlanningTransport(() => source);
  const resetCompany = engine.resetAfterDemoImport;
  if (!resetCompany) throw new Error('The fixture transport must support company resets.');
  const transport = wrap({
    ...engine,
    execute: async (...args) => {
      const generation = resetGeneration;
      const receipt = await engine.execute(...args);
      if (generation !== resetGeneration) return receipt;

      if (receipt.projection.mode === 'patch') {
        source = applyProjection(source, receipt);
      } else {
        // The committed engine slice wins while pendingRefetch protects it from the old source.
        const committed = await engine.read(args[0], args[2]);
        if (generation === resetGeneration) {
          source = replaceCompanyData(source, committed.data, args[0].companyId);
        }
      }
      return receipt;
    },
  });
  setPlanningTransportHandle({
    transport,
    readData,
    reset(companyId, data) {
      resetGeneration += 1;
      source = structuredClone(data);
      resetCompany(companyId, source);
    },
    updateSource(data) {
      resetGeneration += 1;
      source = structuredClone(data);
    },
  });
  return transport;
}
