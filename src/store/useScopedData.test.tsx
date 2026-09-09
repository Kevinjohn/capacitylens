import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { emptyAppData, SCOPED_KEYS, type AppData } from "@capacitylens/shared/types/entities";
import {
  makeAccount,
  makeActivity,
  makeAllocation,
  makeClient,
  makeClosure,
  makeProject,
  makeResource,
  makeTimeOff,
  requireValue,
} from "../test/fixtures";
import {
  resolveSharedActiveData,
  resolveSharedScopedData,
  useActiveScopedData,
  useInactiveScopedData,
  useScopedData,
} from "./useScopedData";
import { useStore } from "./useStore";

const ACCOUNT_A = "a-studio";
const ACCOUNT_B = "a-loft";

function twoAccountData(): AppData {
  return {
    ...emptyAppData(),
    accounts: [
      makeAccount({ id: ACCOUNT_A, name: "Wayne Enterprises" }),
      makeAccount({ id: ACCOUNT_B, name: "Stark Industries" }),
    ],
    disciplines: [
      { id: "d-a", accountId: ACCOUNT_A, createdAt: "t", updatedAt: "t", name: "Design", sortOrder: 1 },
      { id: "d-b", accountId: ACCOUNT_B, createdAt: "t", updatedAt: "t", name: "Engineering", sortOrder: 1 },
    ],
    resources: [
      makeResource({ id: "r-a", accountId: ACCOUNT_A, name: "Bruce Wayne" }),
      makeResource({ id: "r-b", accountId: ACCOUNT_B, name: "Tony Stark" }),
    ],
    clients: [makeClient({ id: "c-a", accountId: ACCOUNT_A }), makeClient({ id: "c-b", accountId: ACCOUNT_B })],
    projects: [
      makeProject({ id: "p-a", accountId: ACCOUNT_A, clientId: "c-a" }),
      makeProject({ id: "p-b", accountId: ACCOUNT_B, clientId: "c-b" }),
    ],
    phases: [
      { id: "phase-a", accountId: ACCOUNT_A, createdAt: "t", updatedAt: "t", name: "Discovery", projectId: "p-a" },
      { id: "phase-b", accountId: ACCOUNT_B, createdAt: "t", updatedAt: "t", name: "Delivery", projectId: "p-b" },
    ],
    activities: [
      makeActivity({ id: "activity-a", accountId: ACCOUNT_A, projectId: "p-a", phaseId: "phase-a" }),
      makeActivity({ id: "activity-b", accountId: ACCOUNT_B, projectId: "p-b", phaseId: "phase-b" }),
    ],
    allocations: [
      makeAllocation({ id: "allocation-a", accountId: ACCOUNT_A, resourceId: "r-a", activityId: "activity-a" }),
      makeAllocation({ id: "allocation-b", accountId: ACCOUNT_B, resourceId: "r-b", activityId: "activity-b" }),
    ],
    timeOff: [
      makeTimeOff({ id: "time-off-a", accountId: ACCOUNT_A, resourceId: "r-a" }),
      makeTimeOff({ id: "time-off-b", accountId: ACCOUNT_B, resourceId: "r-b" }),
    ],
    closures: [
      makeClosure({ id: "closure-a", accountId: ACCOUNT_A }),
      makeClosure({ id: "closure-b", accountId: ACCOUNT_B }),
    ],
  };
}

beforeEach(() => {
  useStore.getState().replaceAll(emptyAppData());
  useStore.getState().setActiveAccount(null);
});

describe("scoped data", () => {
  it("returns only every selected-account collection through the imperative resolver", () => {
    const scoped = resolveSharedScopedData(twoAccountData(), ACCOUNT_A);

    expect(scoped.accounts).toEqual([]);
    for (const table of SCOPED_KEYS) {
      expect(scoped[table]).toHaveLength(1);
      expect(scoped[table].every((row) => row.accountId === ACCOUNT_A)).toBe(true);
    }
  });

  it("returns one stable empty projection without an active account", () => {
    const data = twoAccountData();

    const first = resolveSharedScopedData(data, null);
    const second = resolveSharedScopedData({ ...data }, null);

    expect(second).toBe(first);
    expect(first).toEqual(emptyAppData());
  });

  it("memoises projections by source-data identity and account", () => {
    const data = twoAccountData();
    const a = resolveSharedScopedData(data, ACCOUNT_A);
    const b = resolveSharedScopedData(data, ACCOUNT_B);

    expect(resolveSharedScopedData(data, ACCOUNT_A)).toBe(a);
    expect(b).not.toBe(a);
    expect(resolveSharedScopedData({ ...data, clients: [...data.clients] }, ACCOUNT_A)).not.toBe(a);
  });

  it("updates useScopedData on account changes without retaining the previous account rows", () => {
    useStore.getState().replaceAll(twoAccountData());
    useStore.getState().setActiveAccount(ACCOUNT_A);
    const { result } = renderHook(() => useScopedData());

    expect(result.current.clients.map((client) => client.id)).toEqual(["c-a"]);

    act(() => useStore.getState().setActiveAccount(ACCOUNT_B));

    expect(result.current.clients.map((client) => client.id)).toEqual(["c-b"]);
    expect(result.current.clients).not.toContainEqual(expect.objectContaining({ accountId: ACCOUNT_A }));
  });

  it("projects archived and soft-deleted rows out of active data while retaining them in inactive data", () => {
    const data = twoAccountData();
    data.resources[0] = { ...requireValue(data.resources[0]), archivedAt: "2026-01-01T00:00:00.000Z" };
    data.clients[0] = { ...requireValue(data.clients[0]), deletedAt: "2026-01-02T00:00:00.000Z" };
    useStore.getState().replaceAll(data);
    useStore.getState().setActiveAccount(ACCOUNT_A);
    const { result } = renderHook(() => ({ active: useActiveScopedData(), inactive: useInactiveScopedData() }));

    expect(result.current.active.resources).toEqual([]);
    expect(result.current.active.clients).toEqual([]);
    expect(result.current.active.projects).toEqual([]);
    expect(result.current.inactive.resources.map((resource) => resource.id)).toEqual(["r-a"]);
    expect(result.current.inactive.clients.map((client) => client.id)).toEqual(["c-a"]);
    expect(resolveSharedActiveData(result.current.inactive)).toBe(result.current.active);
  });

  it("preserves the hook projection reference across unrelated store changes", () => {
    useStore.getState().replaceAll(twoAccountData());
    useStore.getState().setActiveAccount(ACCOUNT_A);
    const { result } = renderHook(() => useScopedData());
    const before = result.current;

    act(() => useStore.getState().setNotice("Unrelated"));

    expect(result.current).toBe(before);
  });
});
