import type { PropsWithChildren } from "react";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Activity, Resource } from "@capacitylens/shared/types/entities";
import { AuthContext, type AccountMode } from "../../auth/authContext";
import { PermissionContext, type PermissionContextValue } from "../../auth/permissionContext";
import { useStore } from "../../store/useStore";
import { makeAccount, makeActivity, makeAllocation, makeAppData, makeResource, makeTimeOff } from "../../test/fixtures";
import { usePersonSchedule } from "./usePersonSchedule";

vi.mock("./useCalendarToday", () => ({ useCalendarToday: () => "2026-09-10" }));

function wrapper({
  role = null,
  status = role === null ? "not-applicable" : "resolved",
  authMode = "off",
}: PermissionContextValue & { authMode?: AccountMode }) {
  return function Wrapper({ children }: PropsWithChildren) {
    return (
      <AuthContext.Provider
        value={{
          authMode,
          user: authMode === "off" ? null : { id: "viewer" },
          providers: [],
          canCreateAccount: true,
          multiAccount: true,
          refreshAuth: async () => {},
          signOut: async () => {},
        }}
      >
        <PermissionContext.Provider value={{ role, status }}>{children}</PermissionContext.Provider>
      </AuthContext.Provider>
    );
  };
}

const resource = makeResource({ id: "r1", accountId: "a1", name: "Diana Prince" });

function withoutProjectId(value: Activity): Activity {
  const copy = { ...value };
  delete copy.projectId;
  return copy;
}

function withoutName(value: Resource): Resource {
  const copy = { ...value };
  delete copy.name;
  return copy;
}

const activity = withoutProjectId(makeActivity({ id: "t1", accountId: "a1", kind: "internal" }));

function seed(overrides: Parameters<typeof makeAppData>[0] = {}) {
  useStore.getState().replaceAll(
    makeAppData({
      accounts: [makeAccount({ id: "a1", timezone: "Europe/London", weekStartsOn: 1 })],
      resources: [resource],
      activities: [activity],
      allocations: [makeAllocation({ accountId: "a1", resourceId: resource.id, activityId: activity.id })],
      ...overrides,
    }),
  );
  useStore.getState().setActiveAccount("a1");
}

beforeEach(() => seed());

describe("usePersonSchedule availability", () => {
  it("builds the current account-local four-week window independently of grid dates", () => {
    const monday = renderHook(() => usePersonSchedule({ accountId: "a1", resourceId: "r1" }));
    expect(monday.result.current).toMatchObject({
      kind: "available",
      model: { window: { startDate: "2026-09-07", endDate: "2026-10-04" } },
    });

    act(() => {
      seed({ accounts: [makeAccount({ id: "a1", timezone: "Europe/London", weekStartsOn: 0 })] });
    });
    expect(monday.result.current).toMatchObject({
      kind: "available",
      model: { window: { startDate: "2026-09-06", endDate: "2026-10-03" } },
    });
  });

  it("fails closed for null selections, account mismatches, missing resources, and hidden resource kinds", () => {
    const { result, rerender } = renderHook(
      ({ accountId, resourceId }: { accountId: string | null; resourceId: string | null }) =>
        usePersonSchedule({ accountId, resourceId }),
      {
        initialProps: { accountId: null, resourceId: null } as {
          accountId: string | null;
          resourceId: string | null;
        },
      },
    );
    expect(result.current).toEqual({ kind: "unavailable" });

    rerender({ accountId: "another-account", resourceId: "r1" });
    expect(result.current).toEqual({ kind: "unavailable" });
    rerender({ accountId: "a1", resourceId: "missing" });
    expect(result.current).toEqual({ kind: "unavailable" });

    act(() => seed({ resources: [makeResource({ ...resource, kind: "placeholder" })] }));
    rerender({ accountId: "a1", resourceId: "r1" });
    expect(result.current).toEqual({ kind: "unavailable" });
  });
});

describe("usePersonSchedule permissions and identity", () => {
  it("fails closed while authenticated permissions are unresolved", () => {
    const pending = renderHook(() => usePersonSchedule({ accountId: "a1", resourceId: "r1" }), {
      wrapper: wrapper({ role: "viewer", status: "pending", authMode: "password" }),
    });
    const unavailable = renderHook(() => usePersonSchedule({ accountId: "a1", resourceId: "r1" }), {
      wrapper: wrapper({ role: "viewer", status: "unavailable", authMode: "password" }),
    });
    expect(pending.result.current).toEqual({ kind: "unavailable" });
    expect(unavailable.result.current).toEqual({ kind: "unavailable" });
  });
});

describe("usePersonSchedule authorized projection", () => {
  it("includes placeholder role and discipline context when the row feature is enabled", () => {
    const placeholder = withoutName(
      makeResource({ ...resource, kind: "placeholder", role: "Designer", disciplineId: "discipline-1" }),
    );
    seed({
      accounts: [makeAccount({ id: "a1", placeholdersEnabled: true })],
      resources: [placeholder],
      disciplines: [
        {
          id: "discipline-1",
          accountId: "a1",
          createdAt: "t",
          updatedAt: "t",
          name: "Design",
          sortOrder: 0,
        },
      ],
    });
    const { result } = renderHook(() => usePersonSchedule({ accountId: "a1", resourceId: "r1" }));
    expect(result.current).toMatchObject({
      kind: "available",
      model: { title: "Placeholder — Designer · Design" },
    });
  });

  it.each([
    ["owner", true],
    ["admin", true],
    ["editor", false],
    ["viewer", false],
  ] as const)("projects time-off note visibility for authenticated %s", (role, expected) => {
    seed({
      allocations: [],
      timeOff: [
        makeTimeOff({
          accountId: "a1",
          resourceId: "r1",
          startDate: "2026-09-10",
          endDate: "2026-09-10",
          note: "Private",
        }),
      ],
    });
    const { result } = renderHook(() => usePersonSchedule({ accountId: "a1", resourceId: "r1" }), {
      wrapper: wrapper({ role, status: "resolved", authMode: "password" }),
    });
    expect(result.current.kind).toBe("available");
    if (result.current.kind !== "available") return;
    expect(Object.hasOwn(result.current.model.entries[0] ?? {}, "note")).toBe(expected);
  });
});

describe("usePersonSchedule lifecycle", () => {
  it("retains OFF/demo note semantics and invalidates when the resource leaves active scoped data", () => {
    seed({
      allocations: [],
      timeOff: [
        makeTimeOff({
          accountId: "a1",
          resourceId: "r1",
          startDate: "2026-09-10",
          endDate: "2026-09-10",
          note: "Private",
        }),
      ],
    });
    const { result } = renderHook(() => usePersonSchedule({ accountId: "a1", resourceId: "r1" }));
    expect(result.current).toMatchObject({ kind: "available", model: { entries: [{ note: "Private" }] } });

    act(() => seed({ resources: [{ ...resource, archivedAt: "2026-09-10T00:00:00.000Z" }] }));
    expect(result.current).toEqual({ kind: "unavailable" });
  });
});
