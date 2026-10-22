import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AppData } from "@capacitylens/shared/types/entities";
import type { MasqueradeState, MasqueradeStatus } from "@capacitylens/shared/domain/masquerade";
import { makeAccount, makeAppData } from "@/test/fixtures";
import { useStore } from "@/store/useStore";
import type { PlanningPendingMutation } from "@/data/planning/planningCacheController";
import { createVolatilePlanningTransport } from "@/data/planning/volatilePlanningTransport";
import { reprojectAccess } from "./reprojectAccess";
import { MasqueradeController } from "./masqueradeController";

const reads = vi.hoisted(() => ({ fail: false, count: 0 }));

vi.mock("@/data/planning/volatilePlanningTransport", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/data/planning/volatilePlanningTransport")>();
  return {
    ...actual,
    createStorePlanningTransport: (readData: () => AppData) => {
      const transport = actual.createVolatilePlanningTransport(readData);
      return {
        ...transport,
        read: async (...args: Parameters<typeof transport.read>) => {
          reads.count += 1;
          if (reads.fail) throw new Error("Canonical planning read failed");
          return transport.read(...args);
        },
      };
    },
  };
});

const state: MasqueradeState = {
  accountId: "a-studio",
  targetUserId: "u-viewer",
  targetName: "Selina Kyle",
  effectiveRole: "viewer",
  startedAt: "2026-09-01T10:00:00.000Z",
  token: "token-1",
};

function controllerWithNativeSlice(bootstrapFailure = false) {
  const bootstrapTransport = createVolatilePlanningTransport(() =>
    makeAppData({ accounts: [makeAccount({ id: state.accountId, name: "Wayne Enterprises" })] }),
  );
  const api = {
    status: vi.fn(async (): Promise<MasqueradeStatus> => ({ active: false })),
    start: vi.fn(async () => state),
    end: vi.fn(async () => {}),
  };
  const switchAccount = vi.fn(async (accountId: string | null) => {
    useStore.getState().setActiveAccount(accountId);
    return { kind: "reloaded" as const };
  });
  const controller = new MasqueradeController({
    flush: vi.fn(async () => ({ kind: "clean" as const })),
    suspend: () => useStore.getState().suspendPlanningCommands(),
    reproject: reprojectAccess,
    readBootstrapAccount: async (accountId) => {
      if (bootstrapFailure) throw new Error("Bootstrap company read failed");
      const snapshot = await bootstrapTransport.read(
        { companyId: accountId, identity: "bootstrap" },
        new AbortController().signal,
      );
      return snapshot.data.accounts.find((candidate) => candidate.id === accountId)?.name ?? null;
    },
    switchAccount,
    api,
  });
  return { controller, api, switchAccount };
}

it("keeps a failed bootstrap read gated while allowing a confirmed cold End", async () => {
  const { controller, api, switchAccount } = controllerWithNativeSlice(true);
  await controller.adoptStatus({ active: true, ...state });
  expect(useStore.getState().activeAccountId).toBeNull();
  expect(useStore.getState().masquerade.kind).toBe("starting");
  expect(await controller.end()).toBe(true);
  expect(api.end).toHaveBeenCalledExactlyOnceWith(state.token, "explicit");
  expect(switchAccount).toHaveBeenCalledExactlyOnceWith(null);
  expect(useStore.getState().masquerade.kind).toBe("inactive");
});

beforeEach(() => {
  reads.fail = false;
  reads.count = 0;
  useStore.getState().clearPlanning();
  useStore.getState().setActiveAccount(null);
  useStore.getState().setMasquerade({ kind: "inactive" });
});

afterEach(() => {
  reads.fail = false;
});

async function failSelectedCanonicalRead(controller: MasqueradeController) {
  reads.fail = true;
  await controller.adoptStatus({ active: true, ...state });
  expect(useStore.getState().activeAccountId).toBe("a-studio");
  expect(useStore.getState().planning).toMatchObject({ status: "error", revision: null, pending: null });
  expect(useStore.getState().masquerade.kind).toBe("starting");
  expect(reads.count).toBeGreaterThan(0);
}

it("recovers a selected company after its canonical read fails, but refuses another owner's lock", async () => {
  const { controller, api } = controllerWithNativeSlice();
  await failSelectedCanonicalRead(controller);
  const foreignRelease = useStore.getState().suspendPlanningCommands();
  expect(foreignRelease).toBeTypeOf("function");
  const beforeBlockedRetry = reads.count;
  expect(await controller.retryProjection()).toBe(false);
  expect(await controller.end()).toBe(false);
  expect(reads.count).toBe(beforeBlockedRetry);
  expect(api.end).not.toHaveBeenCalled();
  expect(useStore.getState().masquerade.kind).toBe("starting");
  foreignRelease?.();

  reads.fail = false;
  expect(await controller.retryProjection()).toBe(true);
  expect(useStore.getState().masquerade.kind).toBe("active");
  expect(useStore.getState().planning.status).toBe("ready");
});

it("ends a selected cold member view even while canonical reads keep failing", async () => {
  const { controller, api, switchAccount } = controllerWithNativeSlice();
  await failSelectedCanonicalRead(controller);
  expect(await controller.end()).toBe(true);
  expect(api.end).toHaveBeenCalledExactlyOnceWith(state.token, "explicit");
  expect(switchAccount).toHaveBeenCalledExactlyOnceWith(null);
  expect(useStore.getState().masquerade.kind).toBe("inactive");
  expect(useStore.getState().activeAccountId).toBeNull();
});

it("refuses recovery while a typed mutation remains unresolved", async () => {
  const { controller, api } = controllerWithNativeSlice();
  await failSelectedCanonicalRead(controller);
  const pending = { execution: { mutationId: "pending" } } as PlanningPendingMutation;
  useStore.setState((current) => ({ planning: { ...current.planning, pending } }));
  const before = reads.count;
  expect(await controller.retryProjection()).toBe(false);
  expect(await controller.end()).toBe(false);
  expect(reads.count).toBe(before);
  expect(api.end).not.toHaveBeenCalled();
  expect(useStore.getState().masquerade.kind).toBe("starting");
});
