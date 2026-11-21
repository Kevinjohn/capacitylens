import { setMasqueradeContextReader, setMasqueradeEndedHandler } from '@/data/requestTimeout';
import { createStorePlanningTransport } from '@/data/planning/storePlanningTransport';
import { useStore } from '@/store/useStore';
import { masqueradeApi } from './masqueradeApi';
import { getMasqueradeContextToken, setMasqueradeContextToken } from '@/api/masqueradeContext';
import { MasqueradeModel } from './masqueradeModel';
import { reprojectAccess } from './reprojectAccess';

/** Coordinates company switching into and out of masquerade mode. */
export const masqueradeModel = new MasqueradeModel({
  flush: async () => ({
    kind: useStore.getState().planningReadyForReplacement() ? 'clean' : 'blocked',
  }),
  suspend: () => useStore.getState().suspendPlanningCommands(),
  reproject: reprojectAccess,
  switchCompany: async (companyId) => {
    useStore.getState().setActiveCompany(companyId);
    return companyId === null || (await useStore.getState().refreshPlanning())
      ? { kind: 'reloaded' }
      : { kind: 'failed' };
  },
  readBootstrapCompany: async (companyId) => {
    const snapshot = await createStorePlanningTransport().read(
      {
        identity: Symbol('masquerade bootstrap'),
        companyId,
        masqueradeContextToken: getMasqueradeContextToken(),
      },
      new AbortController().signal,
    );
    // A read that names no revision always carries the rows.
    if (snapshot.slice === 'unchanged') return null;
    return snapshot.data.accounts.find((company) => company.id === companyId)?.name ?? null;
  },
  api: masqueradeApi,
  readState: () => useStore.getState(),
  setContextToken: setMasqueradeContextToken,
});

// Every API request carries the current context proof; a server-ended projection is recovered here.
setMasqueradeContextReader(getMasqueradeContextToken);
setMasqueradeEndedHandler(() => masqueradeModel.restoreServerEndedProjection());
