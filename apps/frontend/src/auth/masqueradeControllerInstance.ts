import { setMasqueradeContextReader, setMasqueradeEndedHandler } from '@/data/requestTimeout';
import { createStorePlanningTransport } from '@/data/planning/storePlanningTransport';
import { useStore } from '@/store/useStore';
import { masqueradeApi } from './masqueradeApi';
import { getMasqueradeContextToken, setMasqueradeContextToken } from '@/api/masqueradeContext';
import { MasqueradeController } from './masqueradeController';
import { reprojectAccess } from './reprojectAccess';

/** Coordinates account switching into and out of masquerade mode. */
export const masqueradeController = new MasqueradeController({
  flush: async () => ({
    kind: useStore.getState().planningReadyForReplacement() ? 'clean' : 'blocked',
  }),
  suspend: () => useStore.getState().suspendPlanningCommands(),
  reproject: reprojectAccess,
  switchAccount: async (companyId) => {
    useStore.getState().setActiveAccount(companyId);
    return companyId === null || (await useStore.getState().refreshPlanning())
      ? { kind: 'reloaded' }
      : { kind: 'failed' };
  },
  readBootstrapAccount: async (companyId) => {
    const snapshot = await createStorePlanningTransport().read(
      {
        identity: Symbol('masquerade bootstrap'),
        companyId,
        masqueradeContextToken: getMasqueradeContextToken(),
      },
      new AbortController().signal,
    );
    return snapshot.data.accounts.find((account) => account.id === companyId)?.name ?? null;
  },
  api: masqueradeApi,
  readState: () => useStore.getState(),
  setContextToken: setMasqueradeContextToken,
});

// Every API request carries the current context proof; a server-ended projection is recovered here.
setMasqueradeContextReader(getMasqueradeContextToken);
setMasqueradeEndedHandler(() => masqueradeController.restoreServerEndedProjection());
