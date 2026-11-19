import { vi } from 'vitest';
// Load the store and auth graph while the file is collected, as the single AuthProvider test file
// did through its signOut import. Otherwise each file's first freshProvider() call transforms it
// cold inside the 5 s test timeout.
import './signOut';

/** A signed-in body defaults to an admitted member so each test states only the gate it exercises. */
const admittedGates = {
  emailVerified: true,
  membershipRequired: false,
  admission: { admitted: true, requirements: {} },
};

export const makeMeResponse = (status: number, body: unknown) =>
  new Response(
    JSON.stringify(
      status === 200 && body && typeof body === 'object' && !Array.isArray(body)
        ? { ...admittedGates, ...body }
        : body,
    ),
    {
      status,
      headers: { 'content-type': 'application/json' },
    },
  );

// Each test creates a fresh module graph, so auth context must come from that same graph.
export async function renderFreshProvider(planningTransport: 'fixture' | 'server' = 'fixture') {
  vi.resetModules();
  if (planningTransport === 'fixture') {
    // Re-register against the same fresh module graph as this provider and its fixture store.
    vi.doMock('@/data/planning/storePlanningTransport', async () => {
      const { createTestPlanningTransport } = await import('@/test/createTestPlanningTransport');
      return { createStorePlanningTransport: createTestPlanningTransport };
    });
  }
  const { AuthProvider } = await import('./AuthProvider');
  const { useStore } = await import('@/store/useStore');
  const { resetStoreWithCompany } = await import('@/test/fixtures');
  // authContext must come from the same fresh module graph as AuthProvider (which imports it
  // internally): a statically-imported useAuth from before vi.resetModules() would read the
  // context object's default value, not whatever this AuthProvider instance provides.
  const { useAuth } = await import('./authContext');
  return {
    AuthProvider,
    useStore,
    useAuth,
    resetStoreWithCompany,
  };
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
